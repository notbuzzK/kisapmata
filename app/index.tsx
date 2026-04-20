import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';
import { Text, View, Button, TouchableOpacity } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { useState, useEffect } from 'react';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Link } from 'expo-router';


export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraOn, setIsCameraOn] = useState(false);

  if (!permission) {
    // Camera permissions are still loading.
    return <View />;
  }

    if (!permission.granted) {
    // Camera permissions are not granted yet.
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <Button onPress={requestPermission} title="grant permission" />
      </View>
    );
  }

  return (
    <View className='flex flex-row gap-2 h-full'>
      <View className="w-3/5 bg-red-200 p-4">
        <View style={styles.container}>
          {isCameraOn ? (
            <CameraView style={styles.camera} />
          ) : (
          <View className="flex-1 w-full items-center justify-center bg-gray-900">
            <Text className="text-white">Camera is Off</Text>
          </View>)}
          <View style={styles.buttonContainer}>
            <Button
              onPress={() => [setIsCameraOn(!isCameraOn)]}
              title='On/Off'
            />
          </View>
        </View>
      </View>
      <View className="w-2/5 bg-green-200">
        <View className="flex flex-col">
          <View className='h-[80%] bg-purple-200'></View>
          <View className='h-[20%] bg-blue-200 p-4 justify-center items-center'>
            <View className='flex flex-row gap-4'>
              <Button
                title='Start'
                onPress={() => console.log('start')}
              />
              <Button
                title='Stop'
              />
            </View>
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