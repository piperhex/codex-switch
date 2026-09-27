import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchIceObserver, patchIceModule } = require('./patch-webrtc-ice.cjs') as {
  patchIceObserver: (source: string) => string; patchIceModule: (source: string) => string;
};
const root = join(dirname(require.resolve('react-native-webrtc/package.json')),
  'android/src/main/java/com/oney/WebRTCModule');

it('patches an unmodified callback and protects against a disposed peer', () => {
  const original = `    public void onIceCandidate(final IceCandidate candidate) {
        Log.d(TAG, "onIceCandidate");

        ThreadUtils.runOnExecutor(() -> {
            candidateParams.putString("candidate", candidate.sdp);
            webRTCModule.sendEvent("peerConnectionGotICECandidate", params);
        });
    }`;
  const fixed = patchIceObserver(original);
  expect(fixed).toContain('webRTCModule.localIceCandidateSdp(id, candidate, localSdp -> {');
  expect(fixed).toContain('candidateParams.putString("candidate", localSdp);');
  expect(fixed).not.toContain('candidate.sdp');
  expect(patchIceObserver(original.replace(/\n/g, '\r\n'))).toBe(fixed.replace(/\n/g, '\r\n'));
  const module = patchIceModule('    private PeerConnection getPeerConnection(int id) {');
  expect(module).toContain('if (getPeerConnection(id) == peer) result.accept(localSdp);');
  expect(module).toContain('ThreadUtils.runOnExecutor');
});

it.each([['PeerConnectionObserver.java', patchIceObserver], ['WebRTCModule.java', patchIceModule]] as const)(
  'applies once to the installed %s and preserves CRLF', (file, patch) => {
    const source = readFileSync(join(root, file), 'utf8');
    const fixed = patch(source);
    expect(patch(fixed)).toBe(fixed);
    const windows = fixed.replace(/\r?\n/g, '\r\n');
    expect(patch(windows)).toBe(windows);
    expect(() => patch(source + source)).toThrow('WebRTC source changed');
    expect(() => patch('upstream implementation changed')).toThrow('WebRTC source changed');
  },
);
