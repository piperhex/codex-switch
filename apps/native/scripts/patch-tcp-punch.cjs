const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error('TCP socket source changed; review port reuse patch.');
  return source.replace(before, after);
}

/** Only sockets explicitly requesting reusePort use the plain TCP punch adapter. */
function applyTcpPunchPatch() {
  const native = path.resolve(__dirname, '..');
  const manifest = require.resolve('react-native-tcp-socket/package.json', { paths: [native] });
  if (JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== '6.4.3') {
    throw new Error('Review TCP port reuse before upgrading react-native-tcp-socket.');
  }
  const directory = path.join(path.dirname(manifest), 'android/src/main/java/com/asterinet/react/tcpsocket');
  const changes = [
    ['TcpSocketClient.java', 'socket = new Socket();',
      'socket = options.hasKey("reusePort") && options.getBoolean("reusePort") ? PunchSocket.client() : new Socket();'],
    ['TcpSocketServer.java', 'serverSocket = new ServerSocket(port, 50, localInetAddress);',
      'serverSocket = options.hasKey("reusePort") && options.getBoolean("reusePort")\n'
        + '                    ? PunchSocket.server(port, localInetAddress) : new ServerSocket(port, 50, localInetAddress);'],
  ].map(([name, before, after]) => {
    const file = path.join(directory, name), original = fs.readFileSync(file, 'utf8');
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    return { file, source: replaceOnce(original.replace(/\r\n/g, '\n'), before, after).replace(/\n/g, newline) };
  });
  const client = changes[0];
  // Punch sockets follow the active system route; Network.bindSocket(Socket) requires a Java-owned descriptor.
  client.source = replaceOnce(client.source, 'if (network != null)',
    'if (network != null && !(socket instanceof PunchSocket))');
  changes.forEach(({ file, source }) => fs.writeFileSync(file, source));
  for (const name of ['PunchSocket.java', 'PunchServer.java', 'PunchDescriptor.java']) {
    fs.copyFileSync(path.join(native, 'patches/tcp', name), path.join(directory, name));
  }
  require('./patch-tcp-lifecycle.cjs').applyTcpLifecyclePatch(directory);
  require('./patch-ios-tcp-punch.cjs').applyIosTcpPunchPatch(path.dirname(manifest));
}

if (require.main === module) applyTcpPunchPatch();
module.exports = { applyTcpPunchPatch };
