package com.asterinet.react.tcpsocket;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import java.lang.reflect.Field;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs the actual dependency's Java socket code with a controllable bridge worker queue. */
public final class TcpLifecycleChecks {
    public static void main(String[] args) throws Exception {
        missingSocket();
        failedNetworkSelection();
        queuedTls();
        for (int iteration = 0; iteration < 100; iteration++) cancelBeforeConnect();
        cancelDuringConnect();
        connectedSocket();
        duplicateServerClose();
        System.out.println("TCP_LIFECYCLE_PASS: missing/failed/queued/connecting/connected/repeated close");
    }

    private static void missingSocket() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.module.destroy(1521);
            fixture.run(0);
            check(fixture.events.events.contains("close:1521"), "missing socket must complete JS cleanup");
        }
    }

    private static void failedNetworkSelection() throws Exception {
        try (Fixture fixture = new Fixture()) {
            Options options = new Options();
            options.values.put("interface", "unavailable-test-interface");
            fixture.module.connect(1, "127.0.0.1", 1, options);
            fixture.run(0);
            fixture.module.destroy(1);
            fixture.run(0);
            check(fixture.events.events.contains("error:1"), "connection failure must reach JS");
            check(fixture.closeCount(1) == 1, "failed connection must close exactly once");
        }
    }

    private static void cancelBeforeConnect() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.module.connect(2, "127.0.0.1", 1, new Options());
            fixture.module.destroy(2);
            fixture.run(1); // The second native worker wins while the connect worker is delayed.
            fixture.run(0);
            check(fixture.client(2).getSocket() == null, "canceled socket was resurrected");
            check(!fixture.events.events.contains("connect:2"), "canceled socket reported connected");
            check(fixture.closeCount(2) == 1, "queued cancellation must close exactly once");
        }
    }

    private static void queuedTls() throws Exception {
        try (Fixture fixture = new Fixture()) {
            Options tls = new Options();
            fixture.module.connect(6, "127.0.0.1", 1, new Options());
            fixture.module.startTLS(6, tls);
            Map<?, ?> pending = (Map<?, ?>) field(fixture.module, "pendingTLS");
            check(pending.get(6).equals(tls), "early client registration must preserve queued TLS options");
            check(fixture.events.events.isEmpty(), "queuing TLS must not access an unconnected socket");
        }
    }

    private static void cancelDuringConnect() throws Exception {
        try (Fixture fixture = new Fixture()) {
            BlockingOptions options = new BlockingOptions();
            fixture.module.connect(3, "127.0.0.1", 1, options);
            AtomicReference<Throwable> failure = new AtomicReference<>();
            Thread connecting = new Thread(() -> {
                try { fixture.run(0); } catch (Throwable error) { failure.set(error); }
            });
            connecting.start();
            try {
                check(options.created.await(5, TimeUnit.SECONDS), "connect did not allocate a socket");
                Socket allocated = fixture.client(3).getSocket();
                fixture.module.destroy(3);
                fixture.run(0);
                check(allocated.isClosed(), "cancel did not close the socket in progress");
            } finally {
                options.release.countDown();
                connecting.join(5000);
            }
            check(!connecting.isAlive(), "connection worker remained blocked");
            check(failure.get() == null, "uncaught connection worker exception: " + failure.get());
            check(!fixture.events.events.contains("connect:3"), "canceled connect event escaped");
            check(fixture.closeCount(3) == 1, "in-progress cancellation must close once");
        }
    }

    private static void connectedSocket() throws Exception {
        try (Fixture fixture = new Fixture();
             ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(5000);
            fixture.module.connect(4, "127.0.0.1", server.getLocalPort(), new Options());
            fixture.run(0);
            check(fixture.events.events.contains("connect:4"), "normal connection failed");
            try (Socket accepted = server.accept()) {
                accepted.setSoTimeout(5000);
                fixture.client(4).write(1, new byte[] { 42 });
                check(accepted.getInputStream().read() == 42, "normal TCP write failed");
                fixture.module.end(4);
                fixture.module.destroy(4);
                fixture.run(0);
                fixture.run(0);
                check(accepted.getInputStream().read() == -1, "TCP close did not reach the peer");
            }
            check(fixture.closeCount(4) == 1, "duplicate close must emit only once");
        }
    }

    private static void duplicateServerClose() throws Exception {
        try (Fixture fixture = new Fixture()) {
            fixture.module.listen(5, new Options());
            fixture.run(0);
            fixture.owned.add(fixture.sockets.get(5));
            fixture.module.close(5);
            fixture.module.close(5);
            fixture.run(0);
            fixture.run(0);
            check(fixture.closeCount(5) == 1, "duplicate server close must be harmless");
        }
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private static class Options implements ReadableMap {
        final Map<String, Object> values = new HashMap<>();
        Options() {
            values.put("host", "127.0.0.1");
            values.put("port", 0);
            values.put("connectTimeout", 1000);
        }
        public boolean hasKey(String key) { return values.containsKey(key); }
        public boolean getBoolean(String key) { return Boolean.TRUE.equals(values.get(key)); }
        public String getString(String key) { return (String) values.get(key); }
        public int getInt(String key) { return (Integer) values.get(key); }
        public ReadableMap getMap(String key) { return null; }
        public ReadableArray getArray(String key) { return null; }
    }

    private static final class BlockingOptions extends Options {
        final CountDownLatch created = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        @Override public boolean hasKey(String key) {
            // The module does not inspect reuseAddress; the client does, after allocating its socket.
            if (key.equals("reuseAddress")) {
                created.countDown();
                try { check(release.await(5, TimeUnit.SECONDS), "cancel was not released"); }
                catch (InterruptedException error) { throw new AssertionError(error); }
            }
            return super.hasKey(key);
        }
    }

    private static final class Fixture implements AutoCloseable {
        final TcpSocketModule module = new TcpSocketModule(null);
        final QueueExecutor executor = new QueueExecutor();
        final TcpEventListener events;
        final Map<Integer, TcpSocket> sockets;
        final Set<TcpSocket> owned = new HashSet<>();

        @SuppressWarnings("unchecked") // The dependency declares this field with this exact generic type.
        Fixture() throws Exception {
            module.initialize();
            events = (TcpEventListener) field(module, "tcpEvtListener");
            sockets = (Map<Integer, TcpSocket>) field(module, "socketMap");
            Field worker = TcpSocketModule.class.getDeclaredField("executorService");
            worker.setAccessible(true);
            ((ExecutorService) worker.get(module)).shutdownNow();
            worker.set(module, executor);
        }

        void run(int index) { executor.tasks.remove(index).run(); }
        TcpSocketClient client(int id) { return (TcpSocketClient) sockets.get(id); }
        long closeCount(int id) { return events.events.stream().filter(event -> event.equals("close:" + id)).count(); }

        @Override public void close() throws Exception {
            owned.addAll(sockets.values());
            for (TcpSocket socket : owned) {
                if (socket instanceof TcpSocketClient) {
                    ((TcpSocketClient) socket).destroy();
                    ((ExecutorService) field(socket, "writeExecutor")).shutdownNow();
                } else {
                    ((TcpSocketServer) socket).close();
                }
                ((ExecutorService) field(socket, "listenExecutor")).shutdownNow();
            }
        }
    }

    private static final class QueueExecutor extends AbstractExecutorService {
        final List<Runnable> tasks = new ArrayList<>();
        public void execute(Runnable task) { tasks.add(task); }
        public void shutdown() {}
        public List<Runnable> shutdownNow() { return new ArrayList<>(); }
        public boolean isShutdown() { return false; }
        public boolean isTerminated() { return false; }
        public boolean awaitTermination(long timeout, TimeUnit unit) { return true; }
    }
}
