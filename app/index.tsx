import { StyleSheet, Text, View, Button, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useEffect, useRef, useMemo, } from 'react';
import { ThemedText } from '@/components/themed-text';

// IMPORTANT: Replace this with your laptop's IPv4 address (run 'ipconfig' on Windows)
// change this every time
const LAPTOP_IP = "192.168.68.107"; 
const SERVER_URL = `http://${LAPTOP_IP}:8000/detect`;

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detections, setDetections] = useState([]);
  const cameraRef = useRef<CameraView>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  // This ensures that as soon as you hit Stop, the boxes vanish
  useEffect(() => {
    if (!isDetecting) {
      setDetections([]);
    }
  }, [isDetecting]);

  // Also, clear boxes if the camera is turned off manually
  useEffect(() => {
    if (!isCameraOn) {
      setDetections([]);
      setIsDetecting(false); // Safety: stop detection if camera is killed
    }
  }, [isCameraOn]);

  // Capture the dimensions of the camera view area
  const onLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  // This function takes a picture and sends it to the server
  const processFrame = async () => {
    if (!cameraRef.current || !isDetecting) return;

    try {
      // 1. Take a low-quality snapshot to keep it fast
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.3, // Lower quality = faster upload
        base64: false,
        skipProcessing: true,
      });

      // 2. Prepare the form data
      const formData = new FormData();
      // @ts-ignore
      formData.append('file', {
        uri: photo.uri,
        name: 'frame.jpg',
        type: 'image/jpeg',
      });

      // 3. Send to Laptop
      const response = await fetch(SERVER_URL, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const data = await response.json();

      // EXTRA GUARD: If the user clicked STOP while we were waiting 
      // for the server, don't update the state and don't loop again.
      if (!isDetecting) {
          setDetections([]);
          return;
      }

      setDetections(data.detections);

      // 4. If still in "Detecting" mode, continue processing
      if (isDetecting) {
        processFrame();
      }
    } catch (error) {
      console.error("Detection Error:", error);
      setIsDetecting(false); // Stop on error
      setDetections([]);
    }
  };

  // Trigger loop when isDetecting changes to true
  useEffect(() => {
    if (isDetecting) {
      processFrame();
    }
  }, [isDetecting]);

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text>We need your permission to show the camera</Text>
        <Button onPress={requestPermission} title="grant permission" />
      </View>
    );
  }

  return (
    <View className='flex flex-row h-full bg-black'>
      {/* LEFT SIDE */}
      <View 
        className="w-3/5 relative bg-black" 
        onLayout={onLayout} // Detect size of this area
      >
        {isCameraOn && (
          <CameraView 
            ref={cameraRef} 
            style={StyleSheet.absoluteFill} // Use absolute fill to prevent layout jumps
            facing="back"
            animateShutter={false} // Prevents some flickering
          />
        )}

        {/* 2. THE OVERLAY: This sits on top and doesn't reset the camera */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* ONLY show boxes if Camera is ON and we are in DETECTING mode */}
          {isCameraOn && isDetecting && detections.map((det, index) => (
            <View 
              key={`box-${index}`}
              style={{
                position: 'absolute',
                borderWidth: 2,
                borderColor: det.label.toLowerCase().includes('pole') ? '#FACC15' : '#4ADE80',
                left: det.box_2d[0] * layout.width,
                top: det.box_2d[1] * layout.height,
                width: (det.box_2d[2] - det.box_2d[0]) * layout.width,
                height: (det.box_2d[3] - det.box_2d[1]) * layout.height,
              }}
            >
              <View className="bg-black/50 self-start px-1">
                <Text style={{fontSize: 10, color: 'white'}}>
                  {det.label} {det.confidence}% | {det.distance}m
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* On/Off UI */}
        <View className='absolute bottom-10 left-5'>
           <Button onPress={() => setIsCameraOn(!isCameraOn)} title={isCameraOn ? "Camera Off" : "Camera On"} />
        </View>
      </View>

      {/* RIGHT SIDE (Obstacles List) */}
      <View className="w-2/5 bg-gray-900 p-4 border-l border-gray-800">
         <Text className="text-white font-bold text-lg mb-4">Detected Obstacles</Text>
         <View className="flex-1">
            {detections.map((det, i) => (
              <View key={i} className="flex-row justify-between p-2 mb-2 bg-gray-800 rounded-lg">
                <View>
                  <Text className="text-white font-semibold capitalize">{det.label}</Text>
                  <Text className="text-gray-400 text-xs">{det.confidence}% confidence</Text>
                </View>
                <Text className="text-green-400 font-bold self-center">{det.distance}m</Text>
              </View>
            ))}
         </View>
         
         <View className="flex-row gap-2 mt-4">
            <TouchableOpacity 
              onPress={() => setIsDetecting(!isDetecting)}
              className={`${isDetecting ? 'bg-red-600' : 'bg-green-600'} flex-1 py-4 rounded-xl items-center`}
            >
              <Text className="text-white font-bold">{isDetecting ? 'STOP' : 'DETECT'}</Text>
            </TouchableOpacity>
         </View>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 64,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    width: '100%',
    paddingHorizontal: 64,
  },
  button: {
    flex: 1,
    alignItems: 'center',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
});