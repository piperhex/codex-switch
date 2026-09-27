package com.asterinet.react.tcpsocket;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketAddress;
import java.net.SocketException;

/** Plain TCP adapter for react-native-tcp-socket. No hidden APIs or TLS. */
public final class PunchSocket extends Socket {
    private PunchDescriptor descriptor;
    private InetSocketAddress local, remote;
    private volatile boolean closed;

    private PunchSocket() {}
    public static Socket client() { return new PunchSocket(); }
    public static ServerSocket server(int port, InetAddress address) throws IOException {
        return new PunchServer(new InetSocketAddress(address, port));
    }

    static Socket accepted(PunchDescriptor descriptor) throws IOException {
        PunchSocket socket = new PunchSocket();
        socket.descriptor = descriptor;
        try { socket.local = descriptor.address(false); socket.remote = descriptor.address(true); }
        catch (IOException error) { descriptor.close(); throw error; }
        return socket;
    }

    @Override public synchronized void bind(SocketAddress address) throws IOException {
        if (closed || descriptor != null) throw new SocketException("TCP socket unavailable");
        descriptor = PunchDescriptor.bind((InetSocketAddress) address);
        local = descriptor.address(false);
    }

    @Override public void connect(SocketAddress address, int timeout) throws IOException {
        if (descriptor == null || closed) throw new SocketException("TCP socket unavailable");
        try {
            descriptor.connect((InetSocketAddress) address, timeout);
            local = descriptor.address(false); remote = descriptor.address(true);
        } catch (IOException error) { close(); throw error; }
    }

    @Override public InputStream getInputStream() {
        return new InputStream() {
            @Override public int read() throws IOException {
                byte[] one = new byte[1]; return read(one, 0, 1) == -1 ? -1 : one[0] & 255;
            }
            @Override public int read(byte[] data, int offset, int length) throws IOException {
                if (length == 0) return 0;
                try { int count = Os.read(descriptor.fd, data, offset, length); return count == 0 ? -1 : count; }
                catch (ErrnoException error) { throw new IOException("TCP read failed", error); }
            }
            @Override public void close() { PunchSocket.this.close(); }
        };
    }

    @Override public OutputStream getOutputStream() {
        return new OutputStream() {
            @Override public void write(int value) throws IOException { write(new byte[]{(byte) value}); }
            @Override public void write(byte[] data, int offset, int length) throws IOException {
                try {
                    while (length > 0) {
                        int count = Os.write(descriptor.fd, data, offset, length);
                        if (count <= 0) throw new IOException("TCP write stopped");
                        offset += count; length -= count;
                    }
                } catch (ErrnoException error) { throw new IOException("TCP write failed", error); }
            }
            @Override public void close() { PunchSocket.this.close(); }
        };
    }

    @Override public void setReuseAddress(boolean enabled) throws SocketException {
        if (!enabled) throw new SocketException("TCP punch requires port reuse");
    }
    @Override public void setTcpNoDelay(boolean enabled) throws SocketException {
        option(OsConstants.IPPROTO_TCP, OsConstants.TCP_NODELAY, enabled);
    }
    @Override public void setKeepAlive(boolean enabled) throws SocketException {
        option(OsConstants.SOL_SOCKET, OsConstants.SO_KEEPALIVE, enabled);
    }
    private void option(int level, int option, boolean enabled) throws SocketException {
        try { Os.setsockoptInt(descriptor.fd, level, option, enabled ? 1 : 0); }
        catch (ErrnoException error) { throw new SocketException("TCP option unavailable"); }
    }
    @Override public InetAddress getLocalAddress() { return local.getAddress(); }
    @Override public int getLocalPort() { return local.getPort(); }
    @Override public InetAddress getInetAddress() { return remote.getAddress(); }
    @Override public int getPort() { return remote.getPort(); }
    @Override public SocketAddress getRemoteSocketAddress() { return remote; }
    @Override public boolean isClosed() { return closed; }
    @Override public synchronized void close() {
        closed = true;
        if (descriptor != null) descriptor.close();
    }
}
