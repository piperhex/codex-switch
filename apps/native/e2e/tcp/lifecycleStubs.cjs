// Only Android/React bridge and TLS event plumbing are substituted. The socket module,
// client, server, and port-reuse adapter are compiled from the installed dependency.
const bridge = 'com/facebook/react/bridge/';
const tcp = 'com/asterinet/react/tcpsocket/';
const stubs = {
  [bridge + 'ReactApplicationContext.java']: `package com.facebook.react.bridge;
    public abstract class ReactApplicationContext extends android.content.Context {}`,
  [bridge + 'ReactContextBaseJavaModule.java']: `package com.facebook.react.bridge;
    public abstract class ReactContextBaseJavaModule {
      public ReactContextBaseJavaModule(ReactApplicationContext context) {}
      public void initialize() {}
      public abstract String getName();
    }`,
  [bridge + 'ReactMethod.java']: 'package com.facebook.react.bridge; public @interface ReactMethod {}',
  [bridge + 'ReadableMap.java']: `package com.facebook.react.bridge;
    public interface ReadableMap {
      boolean hasKey(String key); boolean getBoolean(String key); String getString(String key);
      int getInt(String key); ReadableMap getMap(String key); ReadableArray getArray(String key);
    }`,
  [bridge + 'ReadableArray.java']: `package com.facebook.react.bridge;
    public interface ReadableArray { int size(); String getString(int index); }`,
  [bridge + 'WritableMap.java']: 'package com.facebook.react.bridge; public interface WritableMap {}',
  [bridge + 'Promise.java']: `package com.facebook.react.bridge;
    public interface Promise { void resolve(Object value); void reject(Throwable error); }`,
  [tcp + 'TcpEventListener.java']: `package com.asterinet.react.tcpsocket;
    import java.net.*;
    import java.util.*;
    import java.util.concurrent.CopyOnWriteArrayList;
    import java.util.concurrent.CountDownLatch;
    public class TcpEventListener {
      public final List<String> events = new CopyOnWriteArrayList<>();
      public final CountDownLatch accepted = new CountDownLatch(1);
      public TcpEventListener(Object context) {}
      public void onConnect(int id, TcpSocketClient client) { events.add("connect:" + id); }
      public void onError(int id, Exception error) { events.add("error:" + id); }
      public void onClose(int id, Exception error) { events.add("close:" + id); }
      public void onListen(int id, TcpSocketServer server) { events.add("listen:" + id); }
      public void onConnection(int server, int id, Socket socket) { accepted.countDown(); }
      public void onSecureConnection(int server, int id, Socket socket) {}
      public void onEnd(int id) {}
      public void onData(int id, byte[] data) {}
      public void onWritten(int id, int message, Exception error) {}
    }`,
  [tcp + 'SSLCertificateHelper.java']: `package com.asterinet.react.tcpsocket;
    import com.facebook.react.bridge.ReadableMap;
    import javax.net.ssl.*;
    public class SSLCertificateHelper {
      public static boolean hasIdentity(ReadableMap options) { throw new UnsupportedOperationException(); }
      public static ReadableMap getCertificateInfo(Object socket, boolean peer) {
        throw new UnsupportedOperationException();
      }
      public static SSLSocketFactory createCustomTrustedSocketFactory(Object... args) {
        throw new UnsupportedOperationException();
      }
      public static SSLSocketFactory createBlindSocketFactory() { throw new UnsupportedOperationException(); }
      public static SSLServerSocketFactory createServerSocketFactory(Object... args) {
        throw new UnsupportedOperationException();
      }
    }`,
};
for (const name of ['NonNull', 'Nullable']) {
  stubs[`androidx/annotation/${name}.java`] = `package androidx.annotation; public @interface ${name} {}`;
}
module.exports = stubs;
