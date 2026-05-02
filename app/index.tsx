import { StyleSheet, Text, View, Button, 
         TouchableOpacity, ScrollView, Modal, TextInput } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useEffect, useRef } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';


const LAPTOP_IP  = "192.168.68.100";   // update as needed
const SERVER_URL = `http://${LAPTOP_IP}:8000`;

const MODEL_OPTIONS = [
  { key: "yolo_pretrained",  label: "YOLO\nPretrained",  color: "#6B7280" },
  { key: "yolo_finetuned",   label: "YOLO\nFine-Tuned",  color: "#16A34A" },
  { key: "hybrid_finetuned", label: "Hybrid\nFine-Tuned", color: "#2563EB" },
];

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraOn,   setIsCameraOn]   = useState(false);
  const [isDetecting,  setIsDetecting]  = useState(false);
  const [detections,   setDetections]   = useState([]);
  const [activeModel,  setActiveModel]  = useState("yolo_finetuned");
  const [switching,    setSwitching]    = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [layout,   setLayout]   = useState({ width: 0, height: 0 });
  const [laptopIp, setLaptopIp] = useState("192.168.68.100");
  const [tempIp, setTempIp]     = useState("192.168.68.100");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const serverUrl = `http://${laptopIp}:8000`;

  useEffect(() => {
    async function lock() {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
    }
    lock();
  }, []);

  useEffect(() => { if (!isDetecting) setDetections([]); }, [isDetecting]);
  useEffect(() => {
    if (!isCameraOn) { setDetections([]); setIsDetecting(false); }
  }, [isCameraOn]);

  const onLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  // ── Switch model on server ────────────────────────────────────────────────
  const switchModel = async (modelKey: string) => {
    if (modelKey === activeModel) return;
    setSwitching(true);
    setIsDetecting(false);
    try {
      await fetch(`${serverUrl}/config/${modelKey}`, { method: 'POST' });
      setActiveModel(modelKey);
    } catch (e) {
      console.error("Failed to switch model:", e);
    }
    setSwitching(false);
  };

  // ── Frame processing loop ─────────────────────────────────────────────────
  const processFrame = async () => {
    if (!cameraRef.current || !isDetecting) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3, base64: false, skipProcessing: true,
      });
      const formData = new FormData();
      // @ts-ignore
      formData.append('file', {
        uri: photo.uri, name: 'frame.jpg', type: 'image/jpeg',
      });
      const response = await fetch(`${serverUrl}/detect`, {
        method: 'POST', body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = await response.json();
      if (!isDetecting) { setDetections([]); return; }
      setDetections(data.detections);
      if (isDetecting) processFrame();
    } catch (error) {
      console.error("Detection Error:", error);
      setIsDetecting(false); setDetections([]);
    }
  };

  useEffect(() => { if (isDetecting) processFrame(); }, [isDetecting]);

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text>Camera permission required</Text>
        <Button onPress={requestPermission} title="Grant Permission" />
      </View>
    );
  }

  const activeModelLabel = MODEL_OPTIONS.find(m => m.key === activeModel)?.label ?? "";
  const activeModelColor = MODEL_OPTIONS.find(m => m.key === activeModel)?.color ?? "#fff";
  
  return (
    <View className='flex flex-row h-full bg-black'>

      {/* ── SETTINGS MODAL — inlined directly, not as a sub-component ── */}
      <Modal visible={isSettingsOpen} transparent animationType="fade">
        <View style={{flex:1, backgroundColor:'rgba(0,0,0,0.8)',
                      justifyContent:'center', alignItems:'center'}}>
          <View style={{backgroundColor:'#222', borderRadius:15,
                        width:'50%', padding:20}}>
            <Text style={{color:'white', fontWeight:'bold',
                          fontSize:14, marginBottom:10}}>
              Server IP Address
            </Text>
            <TextInput
              style={{backgroundColor:'#444', color:'white',
                      padding:10, borderRadius:5, fontSize:14}}
              value={tempIp}
              onChangeText={setTempIp}
              placeholder="192.168.x.x"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              autoCorrect={false}
              autoCapitalize="none"
            />
            <Text style={{color:'#9CA3AF', fontSize:10, marginTop:6}}>
              Current: {laptopIp}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setLaptopIp(tempIp);
                setIsDetecting(false);
                setIsSettingsOpen(false);
              }}
              style={{marginTop:16, backgroundColor:'#16A34A',
                      padding:12, borderRadius:8}}
            >
              <Text style={{color:'white', textAlign:'center',
                            fontWeight:'bold'}}>
                Save & Close
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setTempIp(laptopIp);
                setIsSettingsOpen(false);
              }}
              style={{marginTop:8, padding:10}}
            >
              <Text style={{color:'#9CA3AF', textAlign:'center'}}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── LEFT: Camera + Overlays ──────────────────────────────────── */}
      <View className="w-3/5 relative bg-black" onLayout={onLayout}>
        {isCameraOn && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            animateShutter={false}
          />
        )}

        {/* Active model badge — top left */}
        <View style={{
          position:'absolute', top:12, left:12,
          backgroundColor: activeModelColor + 'CC',
          paddingHorizontal:10, paddingVertical:4, borderRadius:8,
        }}>
          <Text style={{color:'white', fontSize:11, fontWeight:'bold'}}>
            {activeModelLabel.replace('\n', ' ')}
          </Text>
        </View>

        {/* Detection boxes overlay */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {isCameraOn && isDetecting && detections.map((det: any, index: number) => (
            <View
              key={`box-${index}`}
              style={{
                position:    'absolute',
                borderWidth: 2,
                borderColor: activeModelColor,
                left:   det.box_2d[0] * layout.width,
                top:    det.box_2d[1] * layout.height,
                width:  (det.box_2d[2] - det.box_2d[0]) * layout.width,
                height: (det.box_2d[3] - det.box_2d[1]) * layout.height,
              }}
            >
              <View style={{backgroundColor:'rgba(0,0,0,0.6)',
                            paddingHorizontal:4}}>
                <Text style={{fontSize:10, color:'white'}}>
                  {det.label} {det.confidence}%
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Camera on/off — bottom left */}
        <View style={{position:'absolute', bottom:16, left:12}}>
          <Button
            onPress={() => setIsCameraOn(!isCameraOn)}
            title={isCameraOn ? "Camera Off" : "Camera On"}
          />
        </View>

        {/* Settings button — bottom right ← NEW */}
        <TouchableOpacity
          onPress={() => {
            setTempIp(laptopIp);        // sync buffer before opening
            setIsSettingsOpen(true);
          }}
          style={{
            position:'absolute', bottom:16, right:12,
            backgroundColor:'rgba(0,0,0,0.55)',
            paddingHorizontal:10, paddingVertical:6,
            borderRadius:8,
            borderWidth:1, borderColor:'rgba(255,255,255,0.15)',
          }}
        >
          <Text style={{color:'white', fontSize:10}}>
            ⚙️  {laptopIp}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── RIGHT: Controls + Detections list ───────────────────────────── */}
      <View className="w-2/5 bg-gray-900 p-4 border-l border-gray-800 flex flex-col">

        {/* Model switcher */}
        <Text className="text-white font-bold text-sm mb-2">Active Model</Text>
        <View className="mb-4 gap-2">
          {MODEL_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => switchModel(opt.key)}
              disabled={switching}
              style={{
                backgroundColor: activeModel === opt.key
                  ? opt.color : '#374151',
                padding: 10, borderRadius: 8,
                opacity: switching ? 0.5 : 1,
              }}
            >
              <Text style={{
                color: 'white', fontWeight: 'bold',
                fontSize: 11, textAlign: 'center',
              }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Detections list */}
        <Text className="text-white font-bold text-sm mb-2">
          Detected Obstacles
        </Text>
        <ScrollView className="flex-1 mb-4">
          {detections.length === 0 ? (
            <Text className="text-gray-500 text-xs">
              {isDetecting ? "Scanning..." : "Press DETECT to start"}
            </Text>
          ) : (
            detections.map((det: any, i: number) => (
              <View key={i}
                className="flex-row justify-between p-2 mb-2 bg-gray-800 rounded-lg">
                <View>
                  <Text className="text-white font-semibold capitalize">
                    {det.label}
                  </Text>
                  <Text className="text-gray-400 text-xs">
                    {det.confidence}% confidence
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>

        {/* Detect / Stop button */}
        <TouchableOpacity
          onPress={() => setIsDetecting(!isDetecting)}
          disabled={!isCameraOn}
          style={{
            backgroundColor: !isCameraOn
              ? '#4B5563'
              : isDetecting ? '#DC2626' : '#16A34A',
            padding: 16, borderRadius: 12, alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>
            {isDetecting ? 'STOP' : 'DETECT'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
});