import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { totpStyles as styles } from './styles';

interface TotpQrScannerProps {
  onClose: () => void;
  onScan: (value: string) => void;
  visible: boolean;
}

export function TotpQrScanner({ onClose, onScan, visible }: TotpQrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setScanned(false);
  }, [visible]);

  const scan = (value: string) => {
    if (scanned) return;
    setScanned(true);
    onScan(value);
  };

  return <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
    {!permission ? <View style={styles.permissionBox}><ActivityIndicator color="#18af8c" /></View>
      : !permission.granted ? <View style={styles.permissionBox}>
        <Text style={styles.permissionTitle}>需要相机权限</Text>
        <Text style={styles.permissionText}>允许使用相机后，即可扫描服务提供的 2FA 二维码。</Text>
        {permission.canAskAgain ? <Pressable style={styles.qrButton} onPress={() => void requestPermission()}>
          <Text style={styles.qrButtonText}>允许使用相机</Text>
        </Pressable> : null}
        <Pressable style={styles.cameraClose} onPress={onClose}>
          <Text style={styles.cameraCloseText}>返回</Text>
        </Pressable>
      </View> : <View style={styles.cameraRoot}>
        <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => scan(result.data)} />
        <View pointerEvents="box-none" style={styles.cameraOverlay}>
          <Text style={styles.cameraTitle}>扫描 2FA 二维码</Text>
          <View style={styles.scanFrame} />
          <View>
            <Text style={styles.cameraHint}>将二维码完整放入取景框内，识别后会自动填写信息。</Text>
            <Pressable style={styles.cameraClose} onPress={onClose}>
              <Text style={styles.cameraCloseText}>取消扫描</Text>
            </Pressable>
          </View>
        </View>
      </View>}
  </Modal>;
}
