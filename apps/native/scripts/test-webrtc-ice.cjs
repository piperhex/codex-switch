const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const output = mkdtempSync(path.join(tmpdir(), 'codex-ice-test-'));
const executable = name => process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
try {
  const source = path.resolve(__dirname, '../patches/webrtc');
  execFileSync(executable('javac'), ['-d', output,
    path.join(source, 'IceCandidateAddress.java'), path.join(source, 'IceCandidateAddressTest.java')],
  { stdio: 'inherit' });
  execFileSync(executable('java'), ['-cp', output, 'com.oney.WebRTCModule.IceCandidateAddressTest'],
    { stdio: 'inherit' });
} finally {
  rmSync(output, { recursive: true, force: true });
}
