const fs = require('node:fs');
const path = require('node:path');

function replaceExact(source, before, after, count = 1) {
  if (source.split(after).length === count + 1) return source;
  if (source.split(before).length !== count + 1) {
    throw new Error('iOS TCP source changed; review the port reuse patch.');
  }
  return source.split(before).join(after);
}

function patchClient(source) {
  const connect = '    NSNumber *localPort = options[@"localPort"];';
  source = replaceExact(source, connect, `${connect}
    _tcpSocket.csw_reusePort = [options[@"reusePort"] boolValue];
    if (_tcpSocket.csw_reusePort) {
        BOOL ipv6 = [localAddress containsString:@":"];
        [_tcpSocket setIPv4Enabled:!ipv6];
        [_tcpSocket setIPv6Enabled:ipv6];
        // GCDAsyncSocket expects ":port" for a wildcard source, including IPv6.
        if ([localAddress isEqualToString:@"0.0.0.0"] || [localAddress isEqualToString:@"::"]) {
            localAddress = @"";
        }
    }`);
  const listen = '    int port = [options[@"port"] intValue];';
  return replaceExact(source, listen, `${listen}
    _tcpSocket.csw_reusePort = [options[@"reusePort"] boolValue];
    if (_tcpSocket.csw_reusePort) {
        BOOL ipv6 = [host containsString:@":"];
        [_tcpSocket setIPv4Enabled:!ipv6];
        [_tcpSocket setIPv6Enabled:ipv6];
        if ([host isEqualToString:@"::"]) host = nil;
    }`);
}

/** Patch only opt-in punch sockets; video HTTP servers and other TCP users keep their defaults. */
function applyIosTcpPunchPatch(directory) {
  const client = path.join(directory, 'ios/TcpSocketClient.m');
  const spec = path.join(directory, 'react-native-tcp-socket.podspec');
  const original = fs.readFileSync(client, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const patched = patchClient(original.replace(/\r\n/g, '\n')).replace(/\n/g, newline);
  const podspec = replaceExact(fs.readFileSync(spec, 'utf8'),
    's.dependency "CocoaAsyncSocket"', 's.dependency "CocoaAsyncSocket", "7.6.5"');
  fs.writeFileSync(client, patched);
  fs.writeFileSync(spec, podspec);
}

module.exports = { applyIosTcpPunchPatch, patchClient, replaceExact };
