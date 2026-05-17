import { StyleSheet, Text, View, Button,
         TouchableOpacity, ScrollView, Modal,
         TextInput, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useEffect, useRef } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Haptics from 'expo-haptics';

const MODEL_OPTIONS = [
  { key: "yolo_pretrained",  label: "YOLO\nPretrained",  color: "#6B7280" },
  { key: "yolo_finetuned",   label: "YOLO\nFine-Tuned",  color: "#16A34A" },
  { key: "hybrid_finetuned", label: "Hybrid\nFine-Tuned", color: "#2563EB" },
];

// Zone color map — only applies to important (center zone) objects
const ZONE_COLORS: Record<string, string> = {
  near:    '#EF4444',   // red
  medium:  '#F97316',   // orange
  far:     '#22C55E',   // green
  unknown: '#FFFFFF',   // white fallback
};

// Vibration patterns per zone (ms)
const ZONE_VIBRATION: Record<string, number[]> = {
  near:   [0, 80, 60, 80, 60, 80],   // three short pulses
  medium: [0, 80, 60, 80],            // two short pulses
  far:    [0, 120],                   // one pulse
};

const HAPTIC_COOLDOWN_MS = 3000;

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraOn,      setIsCameraOn]      = useState(false);
  const [isDetecting,     setIsDetecting]     = useState(false);
  const [detections,      setDetections]      = useState<any[]>([]);
  const [activeModel,     setActiveModel]     = useState("yolo_finetuned");
  const [switching,       setSwitching]       = useState(false);
  const [laptopIp,        setLaptopIp]        = useState("192.168.68.100");
  const [tempIp,          setTempIp]          = useState("192.168.68.100");
  const [isSettingsOpen,  setIsSettingsOpen]  = useState(false);
  const hapticEnabledRef = useRef(true);
  const [hapticEnabledDisplay, setHapticEnabledDisplay] = useState(true);

  const cameraRef        = useRef<CameraView>(null);
  const layoutRef        = useRef({ width: 0, height: 0 });
  const [layout,         setLayout]           = useState({ width: 0, height: 0 });
  const lastHapticRef    = useRef<number>(0);   // timestamp of last haptic fire

  const serverUrl = `http://${laptopIp}:8000`;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
  }, []);

  useEffect(() => { if (!isDetecting) setDetections([]); }, [isDetecting]);
  useEffect(() => {
    if (!isCameraOn) { setDetections([]); setIsDetecting(false); }
  }, [isCameraOn]);

  const onLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    layoutRef.current = { width, height };
    setLayout({ width, height });
  };

  // ── Haptic trigger — respects cooldown and toggle ─────────────────────────
  const triggerHaptic = (zone: string) => {
    if (!hapticEnabledRef.current) return;
    const now = Date.now();
    if (now - lastHapticRef.current < HAPTIC_COOLDOWN_MS) return;
    lastHapticRef.current = now;

    // Use simple duration calls instead of pattern arrays
    // Honor devices handle these more reliably
    if (zone === 'near') {
      Vibration.vibrate(500);        // one long 500ms buzz
    } else if (zone === 'medium') {
      Vibration.vibrate(250);        // medium 250ms buzz
    } else if (zone === 'far') {
      Vibration.vibrate(100);        // short 100ms buzz
    }
  };


  // ── Switch model ──────────────────────────────────────────────────────────
  const switchModel = async (modelKey: string) => {
    if (modelKey === activeModel) return;
    setSwitching(true);
    setIsDetecting(false);
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${serverUrl}/config/${modelKey}`);
      xhr.onload  = () => { setActiveModel(modelKey); setSwitching(false); resolve(); };
      xhr.onerror = () => { setSwitching(false); resolve(); };
      xhr.send();
    });
  };

  // ── Frame processing loop ─────────────────────────────────────────────────
  const processFrame = async () => {
    if (!cameraRef.current || !isDetecting) { setDetections([]); return; }
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3, base64: false, skipProcessing: true,
      });

      const formData = new FormData();
      // @ts-ignore
      formData.append('file', { uri: photo.uri, name: 'frame.jpg', type: 'image/jpeg' });

      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${serverUrl}/detect`);
        xhr.onload = () => {
          if (!isDetecting) { setDetections([]); resolve(); return; }
          try {
            const data = JSON.parse(xhr.responseText);
            const dets: any[] = data.detections ?? [];
            setDetections(dets);

            // Haptic: find the highest priority important detection
            // Priority: near > medium > far
            const important = dets.filter((d: any) => d.important);
            const nearObj   = important.find((d: any) => d.zone === 'near');
            const medObj    = important.find((d: any) => d.zone === 'medium');
            const farObj    = important.find((d: any) => d.zone === 'far');
            const trigger   = nearObj ?? medObj ?? farObj;
            if (trigger) triggerHaptic(trigger.zone);

          } catch (e) { console.error("Parse error:", e); }
          resolve();
        };
        xhr.onerror = () => { setIsDetecting(false); setDetections([]); resolve(); };
        xhr.send(formData);
      });

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

      {/* ── SETTINGS MODAL ────────────────────────────────────────────── */}
      <Modal visible={isSettingsOpen} transparent animationType="fade">
        <View style={{flex:1, backgroundColor:'rgba(0,0,0,0.8)',
                      justifyContent:'center', alignItems:'center'}}>
          <View style={{backgroundColor:'#222', borderRadius:15, width:'50%', padding:20}}>
            <Text style={{color:'white', fontWeight:'bold', fontSize:14, marginBottom:10}}>
              Server IP Address
            </Text>
            <TextInput
              style={{backgroundColor:'#444', color:'white', padding:10, borderRadius:5, fontSize:14}}
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
                setDetections([]);
                setIsCameraOn(false);
                setIsSettingsOpen(false);
              }}
              style={{marginTop:16, backgroundColor:'#16A34A', padding:12, borderRadius:8}}
            >
              <Text style={{color:'white', textAlign:'center', fontWeight:'bold'}}>
                Save & Close
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setTempIp(laptopIp); setIsSettingsOpen(false); }}
              style={{marginTop:8, padding:10}}
            >
              <Text style={{color:'#9CA3AF', textAlign:'center'}}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── LEFT: Camera ─────────────────────────────────────────────── */}
      <View className="w-3/5 relative bg-black" onLayout={onLayout}>
        {isCameraOn && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            animateShutter={false}
          />
        )}

        {/* Center zone indicator — subtle vertical band */}
        {isCameraOn && isDetecting && (
          <View pointerEvents="none" style={{
            position:    'absolute',
            left:        layout.width * 0.30,
            width:       layout.width * 0.40,
            top:         0,
            bottom:      0,
            borderLeftWidth:  1,
            borderRightWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
          }} />
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

        {/* Haptic toggle — top right */}
        <TouchableOpacity
          onPress={() => {
            hapticEnabledRef.current = !hapticEnabledRef.current;
            setHapticEnabledDisplay(hapticEnabledRef.current);  // just for UI display
          }}
          style={{
            position:'absolute', top:12, right:12,
            backgroundColor: hapticEnabledDisplay
              ? 'rgba(34,197,94,0.75)'
              : 'rgba(100,100,100,0.55)',
            paddingHorizontal:10, paddingVertical:4,
            borderRadius:8,
          }}
        >
          <Text style={{color:'white', fontSize:11, fontWeight:'bold'}}>
            {hapticEnabledDisplay ? '📳 Haptic ON' : '🔇 Haptic OFF'}
          </Text>
        </TouchableOpacity>

        {/* Detection boxes overlay */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {isCameraOn && isDetecting && detections.map((det: any, index: number) => {
            const isImportant = det.important;
            // Important objects get zone color, non-important get model color dimmed
            const boxColor = isImportant
              ? ZONE_COLORS[det.zone] ?? '#FFFFFF'
              : activeModelColor + '88';   // dimmed with 53% opacity

            return (
              <View
                key={`box-${index}`}
                style={{
                  position:    'absolute',
                  borderWidth: isImportant ? 2.5 : 1.5,
                  borderColor: boxColor,
                  left:   det.box_2d[0] * layout.width,
                  top:    det.box_2d[1] * layout.height,
                  width:  (det.box_2d[2] - det.box_2d[0]) * layout.width,
                  height: (det.box_2d[3] - det.box_2d[1]) * layout.height,
                }}
              >
                <View style={{backgroundColor:'rgba(0,0,0,0.6)', paddingHorizontal:4}}>
                  <Text style={{fontSize:10, color:'white'}}>
                    {det.label} {det.confidence}%
                    {isImportant && det.distance_cm
                      ? `  ${(det.distance_cm / 100).toFixed(1)}m`
                      : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Camera on/off — bottom left */}
        <View style={{position:'absolute', bottom:16, left:12}}>
          <Button
            onPress={() => setIsCameraOn(!isCameraOn)}
            title={isCameraOn ? "Camera Off" : "Camera On"}
          />
        </View>

        {/* Settings — bottom right */}
        <TouchableOpacity
          onPress={() => { setTempIp(laptopIp); setIsSettingsOpen(true); }}
          style={{
            position:'absolute', bottom:16, right:12,
            backgroundColor:'rgba(0,0,0,0.55)',
            paddingHorizontal:10, paddingVertical:6,
            borderRadius:8,
            borderWidth:1, borderColor:'rgba(255,255,255,0.15)',
          }}
        >
          <Text style={{color:'white', fontSize:10}}>⚙️  {laptopIp}</Text>
        </TouchableOpacity>
      </View>

      {/* ── RIGHT: Controls + Detections list ───────────────────────── */}
      <View className="w-2/5 bg-gray-900 p-4 border-l border-gray-800 flex flex-col">

        <Text className="text-white font-bold text-sm mb-2">Active Model</Text>
        <View className="mb-4 gap-2">
          {MODEL_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => switchModel(opt.key)}
              disabled={switching}
              style={{
                backgroundColor: activeModel === opt.key ? opt.color : '#374151',
                padding:10, borderRadius:8,
                opacity: switching ? 0.5 : 1,
              }}
            >
              <Text style={{color:'white', fontWeight:'bold',
                            fontSize:11, textAlign:'center'}}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-white font-bold text-sm mb-2">
          Detected Obstacles
        </Text>

        {/* Zone legend */}
        <View style={{flexDirection:'row', gap:6, marginBottom:8}}>
          {[['near','#EF4444'], ['medium','#F97316'], ['far','#22C55E']].map(([z, c]) => (
            <View key={z} style={{flexDirection:'row', alignItems:'center', gap:3}}>
              <View style={{width:8, height:8, borderRadius:4,
                            backgroundColor:c}} />
              <Text style={{color:'#9CA3AF', fontSize:9, textTransform:'capitalize'}}>
                {z}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView className="flex-1 mb-4">
          {detections.length === 0 ? (
            <Text className="text-gray-500 text-xs">
              {isDetecting ? "Scanning..." : "Press DETECT to start"}
            </Text>
          ) : (
            detections
              .slice()
              // Sort: important first, then by zone priority
              .sort((a: any, b: any) => {
                if (a.important !== b.important) return a.important ? -1 : 1;
                const priority: Record<string, number> =
                  { near: 0, medium: 1, far: 2, unknown: 3 };
                return (priority[a.zone] ?? 3) - (priority[b.zone] ?? 3);
              })
              .map((det: any, i: number) => {
                const zoneColor = det.important
                  ? ZONE_COLORS[det.zone] ?? '#FFFFFF'
                  : '#6B7280';
                return (
                  <View key={i} style={{
                    flexDirection:'row', justifyContent:'space-between',
                    padding:8, marginBottom:6, borderRadius:8,
                    backgroundColor: '#1F2937',
                    borderLeftWidth: 3,
                    borderLeftColor: zoneColor,
                  }}>
                    <View style={{flex:1}}>
                      <Text style={{color:'white', fontWeight:'bold',
                                    fontSize:12, textTransform:'capitalize'}}>
                        {det.label}
                        {det.important
                          ? <Text style={{color: zoneColor}}> ●</Text>
                          : ''}
                      </Text>
                      <Text style={{color:'#9CA3AF', fontSize:10}}>
                        {det.confidence}% confidence
                      </Text>
                    </View>
                    {det.important && det.distance_cm && (
                      <Text style={{color: zoneColor, fontWeight:'bold',
                                    alignSelf:'center', fontSize:13}}>
                        {(det.distance_cm / 100).toFixed(1)}m
                      </Text>
                    )}
                  </View>
                );
              })
          )}
        </ScrollView>

        <TouchableOpacity
          onPress={() => setIsDetecting(!isDetecting)}
          disabled={!isCameraOn}
          style={{
            backgroundColor: !isCameraOn
              ? '#4B5563'
              : isDetecting ? '#DC2626' : '#16A34A',
            padding:16, borderRadius:12, alignItems:'center',
          }}
        >
          <Text style={{color:'white', fontWeight:'bold', fontSize:16}}>
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