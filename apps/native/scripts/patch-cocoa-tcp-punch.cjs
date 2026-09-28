const fs = require('node:fs');
const path = require('node:path');
const { replaceExact } = require('./patch-ios-tcp-punch.cjs');

function patchHeader(source) {
  const anchor = '@interface GCDAsyncSocket : NSObject';
  return replaceExact(source, anchor, `${anchor}

/** Opt in before listen/connect; every socket sharing a punch port must enable reuse before bind. */
@property (atomic, assign) BOOL csw_reusePort;`);
}

function patchImplementation(source) {
  const listen = '\t\tstatus = setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &reuseOn, sizeof(reuseOn));';
  const replacement = `${listen}
        if (status == 0 && self.csw_reusePort && domain != AF_UNIX) {
            status = setsockopt(socketFD, SOL_SOCKET, SO_REUSEPORT, &reuseOn, sizeof(reuseOn));
        }`;
  // The IP and Unix listeners share this block. The latter must never receive TCP-only options.
  source = replaceExact(source, listen, replacement, 2);
  const bind = '        int result = bind(socketFD, interfaceAddr, (socklen_t)[connectInterface length]);';
  return replaceExact(source, bind, `        if (self.csw_reusePort && interfaceAddr->sa_family != AF_UNIX) {
            int reuseOn = 1;
            if (setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &reuseOn, sizeof(reuseOn)) != 0
                || setsockopt(socketFD, SOL_SOCKET, SO_REUSEPORT, &reuseOn, sizeof(reuseOn)) != 0) {
                if (errPtr) *errPtr = [self errorWithErrno:errno reason:@"TCP port reuse unavailable"];
                return NO;
            }
        }
${bind}`);
}

/** CocoaPods restores these sources on install, so the Podfile runs this before compilation. */
function patchCocoaDirectory(directory) {
  const changes = [['GCDAsyncSocket.h', patchHeader], ['GCDAsyncSocket.m', patchImplementation]]
    .map(([name, patch]) => {
      const file = path.join(directory, name);
      const original = fs.readFileSync(file, 'utf8');
      const newline = original.includes('\r\n') ? '\r\n' : '\n';
      return { file, source: patch(original.replace(/\r\n/g, '\n')).replace(/\n/g, newline) };
    });
  for (const { file, source } of changes) {
    // CocoaPods downloads are read-only; preserve all other permission bits.
    fs.chmodSync(file, fs.statSync(file).mode | 0o200);
    fs.writeFileSync(file, source);
  }
}

function patchPods(pods, version) {
  // Registry pods do not have a Local Podspecs file; use CocoaPods' resolved specification.
  if (version !== '7.6.5') throw new Error('Review iOS TCP port reuse before upgrading CocoaAsyncSocket.');
  patchCocoaDirectory(path.join(pods, 'CocoaAsyncSocket/Source/GCD'));
}

if (require.main === module) patchPods(path.resolve(process.argv[2] || 'ios/Pods'), process.argv[3]);
module.exports = { patchHeader, patchImplementation, patchCocoaDirectory, patchPods };
