const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_NAME = 'react-native-webrtc';
const PACKAGE_VERSION = '124.0.8';
const SOURCE_DIRECTORY = 'android/src/main/java/com/oney/WebRTCModule';
const SOURCES = ['IceCandidateAddress.java', 'LocalIceCandidate.java'];
const ORIGINAL_EVENT = 'candidateParams.putString("candidate", candidate.sdp);';
const FIXED_EVENT = 'candidateParams.putString("candidate", localSdp);';
const EVENT_START = `    public void onIceCandidate(final IceCandidate candidate) {
        Log.d(TAG, "onIceCandidate");

        ThreadUtils.runOnExecutor(() -> {`;
const FIXED_START = `    public void onIceCandidate(final IceCandidate candidate) {
        Log.d(TAG, "onIceCandidate");

        ThreadUtils.runOnExecutor(() -> webRTCModule.localIceCandidateSdp(id, candidate, localSdp -> {`;
const EVENT_END = `            webRTCModule.sendEvent("peerConnectionGotICECandidate", params);
        });
    }`;
const FIXED_END = `            webRTCModule.sendEvent("peerConnectionGotICECandidate", params);
        }));
    }`;
const METHOD_ANCHOR = '    private PeerConnection getPeerConnection(int id) {';
const METHOD = `    void localIceCandidateSdp(int id, IceCandidate candidate,
            java.util.function.Consumer<String> result) {
        PeerConnection peer = getPeerConnection(id);
        if (peer == null) return;
        LocalIceCandidate.sdp(getReactApplicationContext(), peer, candidate, localSdp ->
                ThreadUtils.runOnExecutor(() -> {
                    // Stats can finish after the observer has been disposed.
                    if (getPeerConnection(id) == peer) result.accept(localSdp);
                }));
    }

`;

function replaceOnce(source, original, replacement) {
  const normalized = source.replace(/\r\n/g, '\n');
  if (normalized.split(replacement).length === 2) return source;
  if (normalized.split(original).length !== 2) throw new Error('WebRTC source changed; review the ICE address fix.');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return normalized.replace(original, replacement).replace(/\n/g, newline);
}

function patchIceObserver(source) {
  return replaceOnce(replaceOnce(replaceOnce(source, ORIGINAL_EVENT, FIXED_EVENT), EVENT_START, FIXED_START),
    EVENT_END, FIXED_END);
}
function patchIceModule(source) { return replaceOnce(source, METHOD_ANCHOR, METHOD + METHOD_ANCHOR); }

/** Fail closed on upstream changes; apply the same fix to chat and desktop receive connections. */
function applyWebrtcIcePatch() {
  const nativeDirectory = path.resolve(__dirname, '..');
  const manifestPath = require.resolve(`${PACKAGE_NAME}/package.json`, { paths: [nativeDirectory] });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== PACKAGE_VERSION) {
    throw new Error(`Review the ICE address fix before using ${PACKAGE_NAME} ${manifest.version}.`);
  }
  const target = path.join(path.dirname(manifestPath), SOURCE_DIRECTORY);
  const changes = [['PeerConnectionObserver.java', patchIceObserver], ['WebRTCModule.java', patchIceModule]]
    .map(([file, patch]) => {
      const filename = path.join(target, file);
      const source = fs.readFileSync(filename, 'utf8');
      return { filename, source, changed: patch(source) };
    });
  for (const { filename, source, changed } of changes) {
    if (changed !== source) fs.writeFileSync(filename, changed);
  }
  for (const file of SOURCES) {
    fs.copyFileSync(path.join(nativeDirectory, 'patches/webrtc', file), path.join(target, file));
  }
}

if (require.main === module) applyWebrtcIcePatch();
module.exports = { applyWebrtcIcePatch, patchIceObserver, patchIceModule };
