import { StyleSheet, Text, View, Button,
         TouchableOpacity, ScrollView, Modal,
         TextInput } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useEffect, useRef } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import Slider from '@react-native-community/slider';

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
  const [hapticEnabledDisplay, setHapticEnabledDisplay] = useState(true);
  const [layout,         setLayout]           = useState({ width: 0, height: 0 });
  const [directionEnabledDisplay, setDirectionEnabledDisplay] = useState(true);
  const [confThreshold, setConfThreshold] = useState(40);  // 0-100
  
  const hapticEnabledRef = useRef(true);
  const cameraRef        = useRef<CameraView>(null);
  const layoutRef        = useRef({ width: 0, height: 0 });
  const lastHapticRef    = useRef<number>(0);   // timestamp of last haptic fire
  const isDetectingRef = useRef(false);
  const voiceEnabledRef     = useRef(true);
  const [voiceEnabledDisplay, setVoiceEnabledDisplay] = useState(true);
  const directionEnabledRef     = useRef(true);
  
  const setDetecting = (val: boolean) => {
    isDetectingRef.current = val;
    setIsDetecting(val);
  };


  const nearPlayer  = useAudioPlayer(require('../assets/beep_near.mp3'));
  const mediumPlayer = useAudioPlayer(require('../assets/beep_medium.mp3'));
  const farPlayer   = useAudioPlayer(require('../assets/beep_far.mp3'));

  // Add this right after:
  useEffect(() => {
    // Mute all players immediately on mount
    nearPlayer.volume   = 0;
    mediumPlayer.volume = 0;
    farPlayer.volume    = 0;
    nearPlayer.pause();
    mediumPlayer.pause();
    farPlayer.pause();
    // Restore volume after mount settles
    setTimeout(() => {
      nearPlayer.volume   = 1;
      mediumPlayer.volume = 1;
      farPlayer.volume    = 1;
    }, 500);
  }, []);


  const serverUrl = `http://${laptopIp}:8000`;

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
  }, []);

  useEffect(() => { if (!isDetecting) setDetections([]); }, [isDetecting]);
  // Add to the existing isCameraOn useEffect:
  useEffect(() => {
    if (!isCameraOn) {
      setDetections([]);
      setIsDetecting(false);
      Speech.stop();   // ← add this
    }
  }, [isCameraOn]);

  const onLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    layoutRef.current = { width, height };
    setLayout({ width, height });
  };

  const triggerAlert = async (zone: string, hasDetections: boolean, det?: any) => {
    const now = Date.now();
    if (now - lastHapticRef.current < HAPTIC_COOLDOWN_MS) return;

    const audioOn     = hapticEnabledRef.current;
    const voiceOn     = voiceEnabledRef.current;
    const directionOn = directionEnabledRef.current;

    if (!audioOn && !voiceOn && !directionOn) return;

    lastHapticRef.current = now;

    const VOICE_MESSAGES: Record<string, string> = {
      near:    'Obstacle very close',
      medium:  'Obstacle nearby',
      far:     'Obstacle ahead',
      unknown: 'Obstacle far ahead',
      clear:   'Path is clear',
    };

    // ── Direction from bounding box center x ──────────────────────────────
    let directionMessage = '';
    if (det && directionOn && hasDetections) {
      const x1 = det.box_2d[0];
      const x2 = det.box_2d[2];
      const boxWidth = x2 - x1;

      // How much of the box overlaps each zone
      const leftOverlap   = Math.max(0, Math.min(x2, 0.30) - Math.max(x1, 0.00)) / boxWidth;
      const middleOverlap = Math.max(0, Math.min(x2, 0.70) - Math.max(x1, 0.30)) / boxWidth;
      const rightOverlap  = Math.max(0, Math.min(x2, 1.00) - Math.max(x1, 0.70)) / boxWidth;

      if (middleOverlap >= leftOverlap && middleOverlap >= rightOverlap) {
        directionMessage = 'ahead of you';
      } else if (leftOverlap > rightOverlap) {
        directionMessage = 'on your left';
      } else {
        directionMessage = 'on your right';
      }
    }

    const voiceKey = !hasDetections ? 'clear' : (zone ?? 'unknown');
    const message  = VOICE_MESSAGES[voiceKey] ?? 'Obstacle detected';

    // ── Audio first ────────────────────────────────────────────────────────
    if (audioOn && hasDetections) {
      try {
        if (zone === 'near')        { nearPlayer.seekTo(0);   nearPlayer.play(); }
        else if (zone === 'medium') { mediumPlayer.seekTo(0); mediumPlayer.play(); }
        else if (zone === 'far')    { farPlayer.seekTo(0);    farPlayer.play(); }
      } catch (e) {
        console.error('Audio error:', e);
      }
    }

    // ── Voice zone alert ───────────────────────────────────────────────────
    if (voiceOn) {
      if (audioOn && hasDetections) await new Promise(r => setTimeout(r, 600));
      Speech.stop();
      await new Promise<void>((resolve) => {
        Speech.speak(message, {
          language: 'en',
          pitch:    1.0,
          rate:     1.1,
          onDone:   () => resolve(),
          onError:  () => resolve(),
        });
      });
    }

    // ── Direction alert — plays after voice finishes ───────────────────────
    if (directionOn && directionMessage && hasDetections) {
      if (voiceOn) await new Promise(r => setTimeout(r, 200));
      Speech.speak(directionMessage, {
        language: 'en',
        pitch:    1.0,
        rate:     1.1,
      });
    }
  };


  // ── Switch model ──────────────────────────────────────────────────────────
  const switchModel = async (modelKey: string) => {
    if (modelKey === activeModel) return;
    setSwitching(true);
    setDetecting(false);
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
    if (!cameraRef.current || !isDetectingRef.current) { 
      setDetections([]); 
      return; 
    }
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
          if (!isDetectingRef.current) { setDetections([]); resolve(); return; }
          try {
            const data = JSON.parse(xhr.responseText);
            const dets: any[] = data.detections ?? [];
            setDetections(dets);

            const hasDetections = dets.length > 0;

            if (hasDetections) {
              // Priority: near > medium > far > unknown, across ALL detections
              const byPriority = ['near', 'medium', 'far', 'unknown'];
              let trigger: any = null;
              for (const zone of byPriority) {
                trigger = dets.find((d: any) => d.zone === zone);
                if (trigger) break;
              }
              if (trigger) triggerAlert(trigger.zone, true, trigger);
            } else {
              // No important detections — path is clear
              // Use a longer cooldown for "clear" to avoid it firing constantly
              const now = Date.now();
              if (now - lastHapticRef.current >= HAPTIC_COOLDOWN_MS * 2) {
                triggerAlert('clear', false);
              }
            }

          } catch (e) { console.error("Parse error:", e); }
          resolve();
        };
        xhr.onerror = () => { 
          setDetecting(false); 
          setDetections([]); 
          resolve(); 
        };
        xhr.send(formData);
      });

      if (isDetectingRef.current) processFrame();
    } catch (error) {
      console.error("Detection Error:", error);
      setDetecting(false); 
      setDetections([]);
    }
  };

  useEffect(() => { 
    if (isDetecting) {
      isDetectingRef.current = true;
      processFrame(); 
    }
  }, [isDetecting]);

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
  const visibleDetections = detections.filter(
  (d: any) => d.confidence >= confThreshold
);

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
                setDetecting(false);
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
        {isCameraOn && (
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
        {/* Audio alert toggle — top right */}
        <TouchableOpacity
          onPress={() => {
            hapticEnabledRef.current = !hapticEnabledRef.current;
            setHapticEnabledDisplay(hapticEnabledRef.current);
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
            {hapticEnabledDisplay ? '🔔 Audio ON' : '🔕 Audio OFF'}
          </Text>
        </TouchableOpacity>

        {/* Voice alert toggle — below audio toggle */}
        <TouchableOpacity
          onPress={() => {
            voiceEnabledRef.current = !voiceEnabledRef.current;
            setVoiceEnabledDisplay(voiceEnabledRef.current);
            if (!voiceEnabledRef.current) Speech.stop();
          }}
          style={{
            position:'absolute', top:48, right:12,
            backgroundColor: voiceEnabledDisplay
              ? 'rgba(59,130,246,0.75)'
              : 'rgba(100,100,100,0.55)',
            paddingHorizontal:10, paddingVertical:4,
            borderRadius:8,
          }}
        >
          <Text style={{color:'white', fontSize:11, fontWeight:'bold'}}>
            {voiceEnabledDisplay ? '🗣 Voice ON' : '🔇 Voice OFF'}
          </Text>
        </TouchableOpacity>

        {/* Direction alert toggle */}
        <TouchableOpacity
          onPress={() => {
            directionEnabledRef.current = !directionEnabledRef.current;
            setDirectionEnabledDisplay(directionEnabledRef.current);
            if (!directionEnabledRef.current) Speech.stop();
          }}
          style={{
            position:'absolute', top:84, right:12,
            backgroundColor: directionEnabledDisplay
              ? 'rgba(234,179,8,0.75)'
              : 'rgba(100,100,100,0.55)',
            paddingHorizontal:10, paddingVertical:4,
            borderRadius:8,
          }}
        >
          <Text style={{color:'white', fontSize:11, fontWeight:'bold'}}>
            {directionEnabledDisplay ? '🧭 Direction ON' : '🧭 Direction OFF'}
          </Text>
        </TouchableOpacity>

        {/* Detection boxes overlay */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {isCameraOn && isDetecting && visibleDetections.map((det: any, index: number) => {
            const isImportant = det.important;
            // Important objects get zone color, non-important get model color dimmed
            const boxColor = ZONE_COLORS[det.zone] ?? activeModelColor;

            return (
              <View
                key={`box-${index}`}
                style={{
                  position:    'absolute',
                  borderWidth: 2,
                  borderColor: boxColor,
                  opacity:     det.important ? 1.0 : 0.5,   // center = full, outside = dimmed
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

        {/* Zone legend + confidence threshold */}
        <View style={{marginBottom:8}}>
          {/* Zone color legend */}
          <View style={{flexDirection:'row', gap:6, marginBottom:6}}>
            {[['near','#EF4444'], ['medium','#F97316'], ['far','#22C55E']].map(([z, c]) => (
              <View key={z} style={{flexDirection:'row', alignItems:'center', gap:3}}>
                <View style={{width:8, height:8, borderRadius:4, backgroundColor:c}} />
                <Text style={{color:'#9CA3AF', fontSize:9, textTransform:'capitalize'}}>{z}</Text>
              </View>
            ))}
          </View>

          {/* Confidence threshold slider */}
          <View style={{flexDirection:'row', alignItems:'center', gap:4}}>
            <Text style={{color:'#9CA3AF', fontSize:9, width:20}}>{confThreshold}%</Text>
            <Slider
              style={{flex:1, height:20}}
              minimumValue={0}
              maximumValue={90}
              step={5}
              value={confThreshold}
              onValueChange={setConfThreshold}
              minimumTrackTintColor="#16A34A"
              maximumTrackTintColor="#374151"
              thumbTintColor="#FFFFFF"
            />
            <Text style={{color:'#9CA3AF', fontSize:9}}>min conf</Text>
          </View>
        </View>


        <ScrollView className="flex-1 mb-4">
          {visibleDetections.length === 0 ? (
            <Text className="text-gray-500 text-xs">
              {isDetecting ? "Scanning..." : "Press DETECT to start"}
            </Text>
          ) : (
            visibleDetections
              .slice()
              // Sort: important first, then by zone priority
              .sort((a: any, b: any) => {
                if (a.important !== b.important) return a.important ? -1 : 1;
                const priority: Record<string, number> =
                  { near: 0, medium: 1, far: 2, unknown: 3 };
                return (priority[a.zone] ?? 3) - (priority[b.zone] ?? 3);
              })
              .map((det: any, i: number) => {
                const zoneColor = ZONE_COLORS[det.zone] ?? '#6B7280';
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
                        {det.label}<Text style={{color: zoneColor}}> ●</Text>
                      </Text>
                      <Text style={{color:'#9CA3AF', fontSize:10}}>
                        {det.confidence}% confidence
                      </Text>
                    </View>
                    {det.distance_cm && (
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
          onPress={() => setDetecting(!isDetecting)}
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