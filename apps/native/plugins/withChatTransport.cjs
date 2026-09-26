const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

module.exports = function withChatTransport(config) {
  config = withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application[0];
    // Expo does not map the existing android.usesCleartextTraffic setting into release manifests by itself.
    application.$['android:usesCleartextTraffic'] = config.android?.usesCleartextTraffic ? 'true' : 'false';
    return result;
  });
  return withInfoPlist(config, (result) => {
    result.modResults.NSLocalNetworkUsageDescription = '允许 Codex Switch 直接连接你的电脑';
    // Chat uses data channels; remote desktop only receives video. Neither feature records a microphone.
    delete result.modResults.NSMicrophoneUsageDescription;
    return result;
  });
};
