import { StyleSheet, Text, View, Button, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useEffect, useRef } from 'react';

// IMPORTANT: Replace this with your laptop's IPv4 address (run 'ipconfig' on Windows)
const LAPTOP_IP = "192.168.68.110"; 
const SERVER_URL = `http://${LAPTOP_IP}:8000/detect`;

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detections, setDetections] = useState([]);
  const cameraRef = useRef<CameraView>(null);

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
      // @ts-ignore (Form data typing can be finicky in RN)
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
      setDetections(data.detections);

      // 4. If we are still in "Detecting" mode, do it again immediately
      if (isDetecting) {
        processFrame();
      }
    } catch (error) {
      console.error("Detection Error:", error);
      setIsDetecting(false); // Stop on error
    }
  };

  // Trigger the loop when isDetecting changes to true
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
      {/* LEFT SIDE: CAMERA & OVERLAY */}
      <View className="w-3/5 relative">
        {isCameraOn ? (
          <CameraView 
            ref={cameraRef} 
            style={styles.camera} 
            facing="back"
          >
            {/* Draw Bounding Boxes here */}
            {detections.map((det, index) => {
               // We need to map server coordinates to screen %
               // This is a simplified version
               return (
                 <View 
                   key={index}
                   style={{
                     position: 'absolute',
                     borderWidth: 2,
                     borderColor: det.label === 'pole' ? 'yellow' : 'green',
                     left: `${(det.box[0] / 640) * 100}%`, // Assuming 640px internal server res
                     top: `${(det.box[1] / 480) * 100}%`,
                     width: `${((det.box[2] - det.box[0]) / 640) * 100}%`,
                     height: `${((det.box[3] - det.box[1]) / 480) * 100}%`,
                   }}
                 >
                   <Text style={{color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', fontSize: 10}}>
                     {det.label} {det.confidence}% {det.distance}m
                   </Text>
                 </View>
               );
            })}
          </CameraView>
        ) : (
          <View className="flex-1 items-center justify-center bg-gray-900">
            <Text className="text-white">Camera is Off</Text>
          </View>
        )}
        
        {/* On/Off Floating Button */}
        <View className='absolute bottom-5 left-5'>
           <Button onPress={() => setIsCameraOn(!isCameraOn)} title="Toggle Camera" />
        </View>
      </View>

      {/* RIGHT SIDE: INFO & CONTROLS */}
      <View className="w-2/5 bg-gray-800 border-l border-gray-700">
        <View className="flex flex-col h-full">
          {/* Detected Obstacles List (Matches your Fig 3) */}
          <View className='flex-1 p-4'>
            <Text className='text-white font-bold text-xl mb-4'>Detected Obstacles:</Text>
            {detections.length === 0 && <Text className='text-gray-400'>No obstacles detected.</Text>}
            {detections.map((det, i) => (
              <View key={i} className='flex flex-row justify-between mb-2 bg-gray-700 p-2 rounded'>
                <Text className='text-white'>{det.label}</Text>
                <View className='flex flex-col justify-end'>
                  <Text className='text-green-400'>{det.distance}m</Text>
                  <Text className='text-green-400 justify-end'>{det.confidence}%</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Start/Stop Controls */}
          <View className='h-[20%] bg-gray-900 p-4 flex flex-row gap-4 justify-center items-center'>
            {!isDetecting ? (
              <TouchableOpacity 
                onPress={() => setIsDetecting(true)}
                className='bg-green-600 px-8 py-3 rounded-full'
              >
                <Text className='text-white font-bold'>DETECT</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                onPress={() => setIsDetecting(false)}
                className='bg-red-600 px-8 py-3 rounded-full'
              >
                <Text className='text-white font-bold'>STOP</Text>
              </TouchableOpacity>
            )}
            {isDetecting && <ActivityIndicator color="#fff" />}
          </View>
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