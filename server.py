import cv2, time
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from torchvision.models.detection import ssdlite320_mobilenet_v3_large
from torchvision.models import mobilenet_v3_large, MobileNet_V3_Large_Weights
from torchvision.models.detection.ssdlite import SSDLiteClassificationHead
import torch
import torch.nn as nn
import sys, os

app = FastAPI()

# Allow requests from the React Native app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── CONFIG ─────────────────────────────────────────────────────────────────────
DEVICE      = 'cuda' if torch.cuda.is_available() else 'cpu'
TARGET_SIZE = 512
NUM_CLASSES = 5
CLASS_NAMES = ['barriers', 'foldout-signs', 'poles', 'railings', 'signs']

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Paths — relative to script location
YOLO_PRETRAINED_PATH  = os.path.join(SCRIPT_DIR, "models/yolov8m.pt")
YOLO_FINETUNED_PATH   = os.path.join(SCRIPT_DIR, "models/yolov8m_finetuned.pt")
SSD_FINETUNED_PATH    = os.path.join(SCRIPT_DIR, "models/ssd_custom.pth")
# CENTER_FINETUNED_PATH = os.path.join(SCRIPT_DIR, "models/centernet_custom.pth")
CENTER_FINETUNED_PATH = os.path.join(SCRIPT_DIR, "models/mobilenet_centernet_v2.pth")
CENTER_BASE_WEIGHTS   = os.path.join(SCRIPT_DIR, "models/ctdet_coco_resdcn18.pth")

# ── MODEL LOADING ──────────────────────────────────────────────────────────────
print("Loading models...")

# 1. YOLO pretrained
yolo_pretrained = YOLO(YOLO_PRETRAINED_PATH)

# 2. YOLO fine-tuned
yolo_finetuned = YOLO(YOLO_FINETUNED_PATH)

# 3. SSD fine-tuned
def load_ssd_finetuned(weights_path):
    model = ssdlite320_mobilenet_v3_large(weights='DEFAULT')
    in_channels = [672, 480, 512, 256, 256, 128]
    num_anchors  = [6, 6, 6, 6, 6, 6]
    model.head.classification_head = SSDLiteClassificationHead(
        in_channels=in_channels,
        num_anchors=num_anchors,
        num_classes=NUM_CLASSES + 1,
        norm_layer=nn.BatchNorm2d,
    )
    model.load_state_dict(torch.load(weights_path, map_location=DEVICE))
    return model.to(DEVICE).eval()

# 4. CenterNet fine-tuned

if not os.path.exists('CenterNet'):
    os.system('git clone https://github.com/xingyizhou/CenterNet.git')
sys.path.append('CenterNet/src/lib')

# sys.path.append('CenterNet/src/lib')
from models.networks.msra_resnet import get_pose_net

class MobileNetV3CenterNet(nn.Module):
    def __init__(self, num_classes=5, pretrained=False):
        super().__init__()
        mobilenet     = mobilenet_v3_large(
            weights=MobileNet_V3_Large_Weights.DEFAULT if pretrained else None
        )
        self.backbone = mobilenet.features
        self.decoder  = nn.Sequential(
            nn.ConvTranspose2d(960, 256, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(256), nn.ReLU(inplace=True),
            nn.ConvTranspose2d(256, 128, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(128), nn.ReLU(inplace=True),
            nn.Conv2d(128, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),  nn.ReLU(inplace=True),
        )
        self.hm  = nn.Sequential(
            nn.Conv2d(64, 64, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(64, num_classes, kernel_size=1),
        )
        self.wh  = nn.Sequential(
            nn.Conv2d(64, 64, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(64, 2, kernel_size=1),
        )
        self.reg = nn.Sequential(
            nn.Conv2d(64, 64, kernel_size=3, padding=1), nn.ReLU(inplace=True),
            nn.Conv2d(64, 2, kernel_size=1),
        )

    def forward(self, x):
        feat = self.backbone(x)
        feat = self.decoder(feat)
        return [{'hm': self.hm(feat), 'wh': self.wh(feat), 'reg': self.reg(feat)}]

def load_centernet_finetuned(weights_path):
    model = MobileNetV3CenterNet(num_classes=5, pretrained=False)
    model.load_state_dict(torch.load(weights_path, map_location=DEVICE))
    return model.to(DEVICE).eval()

center_ft = load_centernet_finetuned(CENTER_FINETUNED_PATH)

'''
def load_centernet_finetuned(base_weights_path, ft_weights_path):
    heads = {'hm': 80, 'wh': 2, 'reg': 2}
    model = get_pose_net(num_layers=18, heads=heads, head_conv=64)
    checkpoint = torch.load(base_weights_path, map_location=DEVICE)
    state_dict = checkpoint.get('state_dict', checkpoint)
    model.load_state_dict(state_dict, strict=False)
    model.hm = nn.Sequential(
        nn.Conv2d(256, 64, kernel_size=3, padding=1),
        nn.ReLU(inplace=True),
        nn.Conv2d(64, NUM_CLASSES, kernel_size=1),
    ).to(DEVICE)
    model.load_state_dict(torch.load(ft_weights_path, map_location=DEVICE),
                          strict=False)
    return model.to(DEVICE).eval()

center_ft  = load_centernet_finetuned(CENTER_BASE_WEIGHTS, CENTER_FINETUNED_PATH)
'''
ssd_ft     = load_ssd_finetuned(SSD_FINETUNED_PATH)

print(f"✅ All models loaded on {DEVICE}")

# Active model state — default to best performing
active_config = {"model": "yolo_finetuned"}

# ── INFERENCE HELPERS ──────────────────────────────────────────────────────────
from ensemble_boxes import weighted_boxes_fusion

def decode_centernet(output, target_size, conf_thresh=0.3):
    import torch.nn.functional as F
    hm = torch.sigmoid(output['hm'])
    wh  = output['wh']
    reg = output['reg']

    pad  = 1
    hmax = torch.nn.functional.max_pool2d(hm, 3, stride=1, padding=pad)
    hm   = hm * (hm == hmax).float()

    B, C, H, W = hm.shape
    hm_flat    = hm.view(B, -1)
    scores_all, inds = torch.topk(hm_flat[0], min(100, hm_flat.shape[1]))
    mask       = scores_all > conf_thresh
    scores_all = scores_all[mask]
    inds       = inds[mask]

    if len(inds) == 0:
        return [], [], []

    clses  = (inds // (H * W)).cpu().numpy().astype(int)
    ys     = ((inds % (H * W)) // W).cpu().numpy()
    xs     = ((inds % (H * W)) % W).cpu().numpy()
    reg_np = reg[0].cpu().numpy()
    wh_np  = wh[0].cpu().numpy()

    cx = (xs + reg_np[0, ys, xs]) / W
    cy = (ys + reg_np[1, ys, xs]) / H
    bw = wh_np[0, ys, xs] / target_size
    bh = wh_np[1, ys, xs] / target_size

    x1 = np.clip(cx - bw / 2, 0, 1)
    y1 = np.clip(cy - bh / 2, 0, 1)
    x2 = np.clip(cx + bw / 2, 0, 1)
    y2 = np.clip(cy + bh / 2, 0, 1)

    boxes  = np.stack([x1, y1, x2, y2], axis=1).tolist()
    scores = scores_all.cpu().numpy().tolist()
    labels = clses.tolist()
    return boxes, scores, labels


def run_yolo(img_bgr, model, conf=0.3):
    results = model(img_bgr, imgsz=TARGET_SIZE, conf=conf, verbose=False)[0]
    detections = []
    h, w = img_bgr.shape[:2]
    for box in results.boxes:
        cls      = int(box.cls[0])
        conf_val = round(float(box.conf[0]) * 100)
        coords   = box.xyxy[0].tolist()
        # results.names is always correct for whichever model is loaded
        label = results.names[cls]
        detections.append({
            "label":      label,
            "confidence": conf_val,
            "box_2d":     [coords[0]/w, coords[1]/h,
                           coords[2]/w, coords[3]/h],
        })
    return detections

def run_hybrid(img_bgr, conf=0.3):
    img_resized = cv2.resize(img_bgr, (TARGET_SIZE, TARGET_SIZE))
    img_tensor  = (torch.from_numpy(img_resized / 255.)
                       .permute(2, 0, 1).float().unsqueeze(0).to(DEVICE))
    h, w = img_bgr.shape[:2]

    with torch.no_grad():
        out_ssd    = ssd_ft(img_tensor)[0]
        out_center = center_ft(img_tensor)[-1]

    boxes_ssd  = (out_ssd['boxes'].cpu().numpy() / TARGET_SIZE).tolist()
    scores_ssd = out_ssd['scores'].cpu().numpy().tolist()
    labels_ssd = (out_ssd['labels'].cpu().numpy() - 1).tolist()

    boxes_cen, scores_cen, labels_cen = decode_centernet(out_center, TARGET_SIZE, conf)

    if not boxes_ssd and not boxes_cen:
        return []

    boxes, scores, labels = weighted_boxes_fusion(
        [boxes_ssd,  boxes_cen],
        [scores_ssd, scores_cen],
        [labels_ssd, labels_cen],
        weights=[1, 2], iou_thr=0.45, skip_box_thr=conf,
    )

    detections = []
    for box, score, lbl in zip(boxes, scores, labels):
        if score < conf: continue
        lbl_int = max(0, min(4, int(round(lbl))))
        x1, y1, x2, y2 = box
        detections.append({
            "label":      CLASS_NAMES[lbl_int],
            "confidence": round(float(score) * 100),
            "box_2d":     [float(x1), float(y1), float(x2), float(y2)],
        })
    return detections

def run_hybrid_inference(img_path, conf_thresh=0.1):
    img_resized = cv2.resize(img_path, (TARGET_SIZE, TARGET_SIZE))
    img_tensor  = (torch.from_numpy(img_resized / 255.)
                       .permute(2, 0, 1).float().unsqueeze(0).to(DEVICE))

    torch.cuda.synchronize()
    t1 = time.time()

    with torch.no_grad():
        out_center = center_ft(img_tensor)[-1]

    torch.cuda.synchronize()
    latency = time.time() - t1

    # ── CenterNet decode only
    boxes, scores, labels = decode_centernet(out_center, TARGET_SIZE, conf_thresh)

    if len(boxes) == 0:
        return [], [], [], latency

    return boxes.tolist(), scores.tolist(), labels.tolist(), latency

# ── ROUTES ─────────────────────────────────────────────────────────────────────
@app.get("/config")
def get_config():
    """Returns current active model configuration."""
    return {"active_model": active_config["model"]}


@app.post("/config/{model_name}")
def set_config(model_name: str):
    """
    Switch active model on the fly.
    Valid options: yolo_pretrained, yolo_finetuned,
                   hybrid_pretrained (not available — returns error),
                   hybrid_finetuned
    """
    valid = ["yolo_pretrained", "yolo_finetuned", "hybrid_finetuned"]
    if model_name not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Choose from: {valid}"
        )
    active_config["model"] = model_name
    return {"active_model": model_name, "status": "switched"}


@app.post("/detect")
async def detect_objects(file: UploadFile = File(...)):
    contents = await file.read()
    nparr    = np.frombuffer(contents, np.uint8)
    img_bgr  = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    model_key = active_config["model"]

    # In /detect route — remove is_custom from both calls:
    if model_key == "yolo_pretrained":
        detections = run_yolo(img_bgr, yolo_pretrained)
    elif model_key == "yolo_finetuned":
        detections = run_yolo(img_bgr, yolo_finetuned)
    elif model_key == "hybrid_finetuned":
        detections = run_hybrid_inference(img_bgr)
    else:
        detections = []

    return {
        "detections":   detections,
        "active_model": model_key,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)