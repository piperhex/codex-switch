const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

module.exports = function withChatTransport(config) {
  require('../scripts/patch-tcp-punch.cjs').applyTcpPunchPatch();
  require('../scripts/patch-webrtc-audio.cjs').applyWebrtcAudioPatch();
  config = require('./withIosTcpPunch.cjs')(config);
  config = withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application[0];
    // Expo does not map the existing android.usesCleartextTraffic setting into release manifests by itself.
    application.$['android:usesCleartextTraffic'] = config.android?.usesCleartextTraffic ? 'true' : 'false';
    return result;
  });
  // Register before permission plugins: Expo runs Info.plist mods in reverse registration order.
  return withInfoPlist(config, (result) => {
    result.modResults.NSLocalNetworkUsageDescription = '允许 Codex Switch 连接同一网络中的电脑，用于聊天和远程桌面';
    // Chat uses data channels; remote desktop only receives media. Neither feature records a microphone.
    delete result.modResults.NSMicrophoneUsageDescription;
    return result;
  });
};
