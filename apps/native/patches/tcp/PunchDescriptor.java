package com.asterinet.react.tcpsocket;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructPollfd;
import android.system.StructTimeval;
import android.util.Log;
import java.io.FileDescriptor;
import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Public Android OS APIs; Android's NIO SO_REUSEPORT can report unsupported. */
final class PunchDescriptor implements AutoCloseable {
    // Linux UAPI SO_REUSEPORT is not exported by android.system.OsConstants.
    private static final int SO_REUSEPORT = 15;
    private static final int WRITE_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 20000;
    final FileDescriptor fd;
    final AtomicBoolean closed = new AtomicBoolean();
    Runnable onClose = () -> {};

    PunchDescriptor(FileDescriptor fd) { this.fd = fd; }

    static PunchDescriptor bind(InetSocketAddress address) throws IOException {
        PunchDescriptor result = null;
        try {
            int family = address.getAddress() instanceof Inet6Address ? OsConstants.AF_INET6 : OsConstants.AF_INET;
            result = new PunchDescriptor(Os.socket(family, OsConstants.SOCK_STREAM, 0));
            Os.setsockoptInt(result.fd, OsConstants.SOL_SOCKET, OsConstants.SO_REUSEADDR, 1);
            Os.setsockoptInt(result.fd, OsConstants.SOL_SOCKET, SO_REUSEPORT, 1);
            Os.setsockoptTimeval(result.fd, OsConstants.SOL_SOCKET, OsConstants.SO_SNDTIMEO,
                StructTimeval.fromMillis(WRITE_TIMEOUT_MS));
            Os.setsockoptTimeval(result.fd, OsConstants.SOL_SOCKET, OsConstants.SO_RCVTIMEO,
                StructTimeval.fromMillis(READ_TIMEOUT_MS));
            Os.bind(result.fd, address.getAddress(), address.getPort());
            return result;
        } catch (ErrnoException | IOException error) {
            if (result != null) result.close();
            throw new IOException("TCP bind failed", error);
        }
    }

    void connect(InetSocketAddress address, int timeout) throws IOException {
        try {
            int flags = Os.fcntlInt(fd, OsConstants.F_GETFL, 0);
            Os.fcntlInt(fd, OsConstants.F_SETFL, flags | OsConstants.O_NONBLOCK);
            try { Os.connect(fd, address.getAddress(), address.getPort()); }
            catch (ErrnoException error) {
                if (error.errno != OsConstants.EINPROGRESS) throw error;
                StructPollfd poll = new StructPollfd(); poll.fd = fd; poll.events = (short) OsConstants.POLLOUT;
                if (Os.poll(new StructPollfd[]{poll}, timeout > 0 ? timeout : WRITE_TIMEOUT_MS) == 0) {
                    throw new SocketTimeoutException("TCP connect timed out");
                }
                if ((poll.revents & (OsConstants.POLLERR | OsConstants.POLLHUP | OsConstants.POLLNVAL)) != 0) {
                    throw new IOException("TCP connect failed");
                }
                Os.getpeername(fd);
            }
            Os.fcntlInt(fd, OsConstants.F_SETFL, flags);
        } catch (ErrnoException error) { throw new IOException("TCP connect failed", error); }
    }

    InetSocketAddress address(boolean peer) throws IOException {
        try { return (InetSocketAddress) (peer ? Os.getpeername(fd) : Os.getsockname(fd)); }
        catch (ErrnoException error) { throw new IOException("TCP address unavailable", error); }
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        try { Os.shutdown(fd, OsConstants.SHUT_RDWR); }
        catch (ErrnoException ignored) { /* A connecting/listening socket may not be connected yet. */ }
        try { Os.close(fd); }
        catch (ErrnoException error) { Log.w("CodexTcp", "Socket cleanup failed", error); }
        finally { onClose.run(); }
    }
}
