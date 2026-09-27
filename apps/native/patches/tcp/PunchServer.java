package com.asterinet.react.tcpsocket;

import android.system.ErrnoException;
import android.system.Os;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.atomic.AtomicInteger;

final class PunchServer extends ServerSocket {
    private final PunchDescriptor descriptor;
    private final InetSocketAddress local;
    private static final int MAX_ACCEPTED = 8;
    private final AtomicInteger accepted = new AtomicInteger();

    PunchServer(InetSocketAddress address) throws IOException {
        descriptor = PunchDescriptor.bind(address);
        try { local = descriptor.address(false); Os.listen(descriptor.fd, 8); }
        catch (ErrnoException | IOException error) { descriptor.close(); throw new IOException(error); }
    }

    @Override public Socket accept() throws IOException {
        try {
            while (!isClosed()) {
                PunchDescriptor incoming = new PunchDescriptor(Os.accept(descriptor.fd, null));
                if (accepted.incrementAndGet() > MAX_ACCEPTED) {
                    accepted.decrementAndGet(); incoming.close(); continue;
                }
                incoming.onClose = () -> accepted.decrementAndGet();
                return PunchSocket.accepted(incoming);
            }
            throw new IOException("TCP listener closed");
        }
        catch (ErrnoException error) { throw new IOException("TCP accept failed", error); }
    }
    @Override public void setReuseAddress(boolean enabled) { /* Set before bind by PunchDescriptor. */ }
    @Override public InetAddress getInetAddress() { return local.getAddress(); }
    @Override public int getLocalPort() { return local.getPort(); }
    @Override public boolean isClosed() { return descriptor.closed.get(); }
    @Override public void close() { descriptor.close(); }
}
