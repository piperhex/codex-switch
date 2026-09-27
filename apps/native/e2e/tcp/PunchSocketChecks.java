import com.asterinet.react.tcpsocket.PunchSocket;
import java.net.*;
import java.util.concurrent.*;

/** Run on Android with app_process; exercises production sockets without touching app data or UI. */
public final class PunchSocketChecks {
    public static void main(String[] args) throws Exception {
        for (String host : new String[]{"127.0.0.1", "::1"}) check(host);
        System.out.println("TCP_REUSE_PASS");
    }

    private static Socket dial(ServerSocket target, int localPort) throws Exception {
        Socket socket = PunchSocket.client();
        try {
            socket.bind(new InetSocketAddress(target.getInetAddress(), localPort));
            socket.connect(new InetSocketAddress(target.getInetAddress(), target.getLocalPort()), 2000);
            return socket;
        } catch (Exception error) { socket.close(); throw error; }
    }

    private static void check(String host) throws Exception {
        InetAddress address = InetAddress.getByName(host);
        try (ServerSocket discovery = new ServerSocket(0, 8, address);
             ServerSocket listener = PunchSocket.server(0, address);
             ServerSocket peer = PunchSocket.server(0, address);
             Socket mapped = dial(discovery, listener.getLocalPort());
             Socket observed = discovery.accept();
             Socket outgoing = dial(peer, listener.getLocalPort());
             Socket incoming = peer.accept()) {
            if (observed.getPort() != listener.getLocalPort() || incoming.getPort() != listener.getLocalPort()) {
                throw new AssertionError("Listening, discovery and peer ports differ");
            }
            outgoing.setTcpNoDelay(true); incoming.setKeepAlive(true);
            byte[] payload = new byte[65536];
            for (int i = 0; i < payload.length; i++) payload[i] = (byte) i;
            outgoing.getOutputStream().write(payload);
            byte[] received = new byte[payload.length];
            int read = 0;
            while (read < received.length) {
                int count = incoming.getInputStream().read(received, read, received.length - read);
                if (count < 0) throw new AssertionError("Unexpected EOF");
                read += count;
            }
            if (!java.util.Arrays.equals(payload, received)) throw new AssertionError("Corrupt TCP data");
            incoming.getOutputStream().write(42);
            if (outgoing.getInputStream().read() != 42) throw new AssertionError("No reverse traffic");
            closeUnblocks(incoming);
            System.out.println(host + " source-port=" + observed.getPort() + " bytes=" + read);
        }
    }

    private static void closeUnblocks(Socket socket) throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<?> read = worker.submit(() -> {
                try { socket.getInputStream().read(); }
                catch (java.io.IOException expected) { /* Closing interrupts the waiting read. */ }
            });
            socket.close(); read.get(2, TimeUnit.SECONDS);
        } finally { worker.shutdownNow(); }
    }
}
