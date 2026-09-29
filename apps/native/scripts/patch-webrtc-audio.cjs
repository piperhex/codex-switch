const fs = require('node:fs');
const path = require('node:path');

const IOS_ANCHOR = '        WebRTCModuleOptions *options = [WebRTCModuleOptions sharedInstance];';
const IOS_PLAYBACK = `#if !TARGET_OS_OSX
        // Remote AI receives desktop sound; it never opens an audio input.
        RTCAudioSessionConfiguration *playback = [RTCAudioSessionConfiguration webRTCConfiguration];
        playback.category = AVAudioSessionCategoryPlayback;
        playback.categoryOptions = 0;
        playback.mode = AVAudioSessionModeDefault;
        [RTCAudioSessionConfiguration setWebRTCConfiguration:playback];
#endif
${IOS_ANCHOR}`;
const ANDROID_ANCHOR = 'JavaAudioDeviceModule.builder(reactContext).setEnableVolumeLogger(false)';
const ANDROID_PLAYBACK = `JavaAudioDeviceModule.builder(reactContext)
                    .setAudioAttributes(new android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setEnableVolumeLogger(false)`;

function replaceOnce(source, original, replacement) {
  const normalized = source.replace(/\r\n/g, '\n');
  if (normalized.split(replacement).length === 2) return source;
  if (normalized.split(original).length !== 2) throw new Error('WebRTC source changed; review desktop audio playback.');
  return normalized.replace(original, replacement).replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n');
}
const patchIos = source => replaceOnce(source, IOS_ANCHOR, IOS_PLAYBACK);
const patchAndroid = source => replaceOnce(source, ANDROID_ANCHOR, ANDROID_PLAYBACK);

function applyWebrtcAudioPatch() {
  const manifest = require.resolve('react-native-webrtc/package.json', { paths: [path.resolve(__dirname, '..')] });
  if (JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== '124.0.8') {
    throw new Error('Review desktop audio playback before updating react-native-webrtc.');
  }
  const changes = [
    ['ios/RCTWebRTC/WebRTCModule.m', patchIos],
    ['android/src/main/java/com/oney/WebRTCModule/WebRTCModule.java', patchAndroid],
  ].map(([file, patch]) => {
    const filename = path.join(path.dirname(manifest), file);
    const source = fs.readFileSync(filename, 'utf8');
    return { filename, source, changed: patch(source) };
  });
  for (const { filename, source, changed } of changes) if (source !== changed) fs.writeFileSync(filename, changed);
}

if (require.main === module) applyWebrtcAudioPatch();
module.exports = { applyWebrtcAudioPatch, patchIos, patchAndroid };
