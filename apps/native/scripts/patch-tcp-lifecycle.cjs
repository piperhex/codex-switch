const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, original, replacement) {
  const normalized = source.replace(/\r\n/g, '\n');
  if (normalized.split(replacement).length === 2) return source;
  if (normalized.split(original).length !== 2) throw new Error('TCP socket source changed; review lifecycle patch.');
  return normalized.replace(original, replacement).replace(/\n/g, source.includes('\r\n') ? '\r\n' : '\n');
}

function patchConnection(source) {
  source = replaceOnce(source, `        executorService.execute(new Runnable() {
            @Override
            public void run() {
                if (socketMap.get(cId) != null) {
                    tcpEvtListener.onError(cId, new Exception("connect() called twice with the same id."));
                    return;
                }
                try {`, `        // Register before dispatch: a second worker can receive destroy while connect is still queued.
        final TcpSocketClient client = new TcpSocketClient(tcpEvtListener, cId, null);
        if (socketMap.putIfAbsent(cId, client) != null) {
            tcpEvtListener.onError(cId, new Exception("connect() called twice with the same id."));
            return;
        }
        executorService.execute(new Runnable() {
            @Override
            public void run() {
                try {`);
  source = replaceOnce(source, `                    TcpSocketClient client = new TcpSocketClient(tcpEvtListener, cId, null);
                    socketMap.put(cId, client);
                    ReadableMap tlsOptions = pendingTLS.get(cId);`,
  `                    // Reuse the client registered before dispatch, including its cancellation state.
                    ReadableMap tlsOptions = pendingTLS.get(cId);`);
  source = replaceOnce(source, `                    tcpEvtListener.onConnect(cId, client);
                } catch (Exception e) {
                    tcpEvtListener.onError(cId, e);
                }`, `                    synchronized (client) {
                        if (client.getSocket() != null) tcpEvtListener.onConnect(cId, client);
                    }
                } catch (Exception e) {
                    tcpEvtListener.onError(cId, e);
                    client.destroy();
                }`);
  source = replaceOnce(source, '        if (socketClient == null) {',
    '        if (socketClient == null || socketClient.getSocket() == null) {');
  return source;
}

function patchModule(source) {
  source = patchConnection(source);
  source = replaceOnce(source, `                TcpSocketClient socketClient = getTcpClient(cId);
                socketClient.destroy();`, `                TcpSocket socket = socketMap.get(cId);
                // Cleanup after a failed or already absent connection must still complete on the JS side.
                if (socket == null) {
                    tcpEvtListener.onClose(cId, null);
                } else if (socket instanceof TcpSocketClient) {
                    ((TcpSocketClient) socket).destroy();
                } else {
                    tcpEvtListener.onError(cId, new IllegalArgumentException("Socket is not a client"));
                }`);
  return replaceOnce(source, `                TcpSocketServer socketServer = getTcpServer(cId);
                socketServer.close();
                socketMap.remove(cId);`, `                TcpSocket socket = socketMap.get(cId);
                if (socket == null) return;
                if (!(socket instanceof TcpSocketServer)) {
                    tcpEvtListener.onError(cId, new IllegalArgumentException("Socket is not a server"));
                    return;
                }
                synchronized (socket) {
                    ((TcpSocketServer) socket).close();
                    socketMap.remove(cId, socket);
                }`);
}

function patchSocketCreation(source) {
  source = replaceOnce(source, '    private Socket socket;\n    private boolean closed = true;',
    '    private volatile Socket socket;\n    private volatile boolean closed = true;\n    private boolean destroyed;');
  const start = '        if (socket != null) throw new IOException("Already connected");';
  const end = '        // Get the addresses';
  const normalized = source.replace(/\r\n/g, '\n');
  const creation = normalized.slice(normalized.indexOf(start), normalized.indexOf(end));
  const helper = '    private synchronized Socket createSocket(';
  if (!normalized.includes(helper)) {
    if (!creation.startsWith(start) || !creation.includes('socket = new Socket();')
      && !creation.includes('PunchSocket.client()')) throw new Error('TCP socket source changed; review lifecycle patch.');
    source = replaceOnce(source, creation, '        final Socket socket = createSocket(context, options, tlsOptions);\n');
    const anchor = '    public void startTLS(Context context, ReadableMap tlsOptions)';
    source = replaceOnce(source, anchor, `${helper}
            Context context, ReadableMap options, ReadableMap tlsOptions) throws IOException, GeneralSecurityException {
        // A canceled connection must never allocate a new socket after destroy has completed.
        if (destroyed) throw new IOException("Socket is closed");
${creation}        return socket;
    }

${anchor}`);
  }
  return source;
}

function patchClient(source) {
  source = patchSocketCreation(source);
  source = replaceOnce(source, `    public void destroy() {
        try {
            // close the socket
            if (socket != null && !socket.isClosed()) {
                closed = true;
                socket.close();
                receiverListener.onClose(getId(), null);
                socket = null;
            }
        } catch (IOException e) {
            receiverListener.onClose(getId(), e);
        }
    }`, `    public synchronized void destroy() {
        if (destroyed) return;
        destroyed = true;
        closed = true;
        final Socket closingSocket = socket;
        socket = null;
        try {
            if (closingSocket != null) closingSocket.close();
            receiverListener.onClose(getId(), null);
        } catch (IOException e) {
            receiverListener.onClose(getId(), e);
        }
    }`);
  for (const signature of ['setNoDelay(final boolean noDelay)',
    'setKeepAlive(final boolean enable, final int initialDelay)']) {
    source = replaceOnce(source, `    public void ${signature} throws IOException {`,
      `    public void ${signature} throws IOException {\n        final Socket socket = this.socket;`);
  }
  return source;
}

function patchServer(source) {
  source = replaceOnce(source, '    private ServerSocket serverSocket;',
    '    private final ServerSocket serverSocket;');
  return replaceOnce(source, `    public void close() {
        try {
            // close the socket
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
                mReceiverListener.onClose(getId(), null);
                serverSocket = null;
            }
        } catch (IOException e) {
            mReceiverListener.onClose(getId(), e);
        }
    }`, `    public synchronized void close() {
        try {
            // Keep the socket reference: a queued listener may start after close has completed.
            if (!serverSocket.isClosed()) {
                serverSocket.close();
                mReceiverListener.onClose(getId(), null);
            }
        } catch (IOException e) {
            mReceiverListener.onClose(getId(), e);
        } finally {
            // Closing the socket wakes accept(); shutdown also releases the idle worker.
            listenExecutor.shutdown();
        }
    }`);
}

function applyTcpLifecyclePatch(directory) {
  const changes = [['TcpSocketModule.java', patchModule], ['TcpSocketClient.java', patchClient],
    ['TcpSocketServer.java', patchServer]]
    .map(([name, patch]) => {
      const file = path.join(directory, name), source = fs.readFileSync(file, 'utf8');
      return { file, source, changed: patch(source) };
    });
  for (const { file, source, changed } of changes) if (source !== changed) fs.writeFileSync(file, changed);
}

module.exports = { applyTcpLifecyclePatch, patchModule, patchClient, patchServer };
