import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile
from ultralytics import YOLO
import io
from PIL import Image
import math

app = FastAPI()

# Load the model once when the server starts
# Uses pretrained YOLOv8m temporarily
model = YOLO("yolov8m.pt") 

@app.post("/detect")
async def detect_objects(file: UploadFile = File(...)):
    # 1. Read the image sent from the phone
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # 2. Run Inference
    results = model(img)[0]
    
    detections = []

    img_h, img_w, _ = img.shape # Get dimensions of the image the phone actually sent
    
    # 3. Parse results into JSON
    for box in results.boxes:
        coords = box.xyxy[0].tolist() # [xmin, ymin, xmax, ymax]

        # Calculate normalized coordinates (0.0 to 1.0)
        # [xmin, ymin, xmax, ymax]
        norm_box = [
            coords[0] / img_w, 
            coords[1] / img_h, 
            coords[2] / img_w, 
            coords[3] / img_h
        ]

        conf = math.floor(float(box.conf[0] * 100))
        cls = int(box.cls[0])
        label = results.names[cls]
        
        # Simple Distance Estimation Logic
        # Distance = (Known Width of Object * Focal Length) / Width in Pixels
        # Demo distance calculation only
        # TODO: figure out distance estimation
        dist = round(100 / ( (coords[3] - coords[1]) / img.shape[0] ), 1)

        detections.append({
            "label": label,
            "confidence": conf,
            "box_2d": norm_box,
            "distance": dist
        })

    return {"detections": detections}

if __name__ == "__main__":
    import uvicorn
    # Run on 0.0.0.0 so it's accessible on the local network
    uvicorn.run(app, host="0.0.0.0", port=8000)