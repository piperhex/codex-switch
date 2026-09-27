package com.oney.WebRTCModule;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Log;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import org.webrtc.IceCandidate;
import org.webrtc.PeerConnection;
import org.webrtc.RTCStats;
import org.webrtc.RTCStatsReport;

/** Only adjusts signaling; never changes sockets, process routing, or the user's VPN policy. */
final class LocalIceCandidate {
    private static final String TAG = "LocalIceCandidate";

    private LocalIceCandidate() {}

    static void sdp(Context context, PeerConnection peer, IceCandidate candidate, Consumer<String> result) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null || peer == null) { result.accept(candidate.sdp); return; }
        try {
            Addresses addresses = read(manager);
            // Most candidates need no stats lookup. Only the erroneous VPN-address case is asynchronous.
            if (IceCandidateAddress.repair(candidate.sdp, addresses.vpn, addresses.wifi).equals(candidate.sdp)
                    && IceCandidateAddress.repair(candidate.sdp, addresses.vpn, addresses.ethernet)
                            .equals(candidate.sdp)) { result.accept(candidate.sdp); return; }
            peer.getStats(report -> result.accept(repair(candidate.sdp, addresses, report)));
        } catch (SecurityException error) {
            // A restricted device can hide network metadata. Keep the unmodified candidate.
            Log.w(TAG, "Network metadata unavailable; keeping the original ICE candidate");
            result.accept(candidate.sdp);
        }
    }

    private static class Addresses {
        final Set<String> vpn = new HashSet<>();
        final Set<String> wifi = new HashSet<>();
        final Set<String> ethernet = new HashSet<>();
    }

    private static Addresses read(ConnectivityManager manager) {
        Addresses addresses = new Addresses();
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities == null) continue;
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                collect(manager.getLinkProperties(network), addresses.vpn);
            } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                collect(manager.getLinkProperties(network), addresses.wifi);
            } else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                collect(manager.getLinkProperties(network), addresses.ethernet);
            }
        }
        return addresses;
    }

    private static String repair(String sdp, Addresses addresses, RTCStatsReport report) {
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (RTCStats stats : report.getStatsMap().values()) {
            if ("local-candidate".equals(stats.getType())) candidates.add(stats.getMembers());
        }
        // M124's onIceCandidate JNI callback always reports adapterType=UNKNOWN; stats retain the real type.
        String type = IceCandidateAddress.physicalNetworkType(sdp, candidates);
        Set<String> physical = new HashSet<>();
        if (type.equals("wifi")) physical = addresses.wifi;
        if (type.equals("ethernet")) physical = addresses.ethernet;
        String repaired = IceCandidateAddress.repair(sdp, addresses.vpn, physical);
        if (!repaired.equals(sdp)) Log.d(TAG, "Corrected a physical-network ICE candidate address");
        return repaired;
    }

    private static void collect(LinkProperties properties, Set<String> addresses) {
        if (properties == null) return;
        for (LinkAddress link : properties.getLinkAddresses()) {
            InetAddress address = link.getAddress();
            if (address instanceof Inet4Address && !address.isLoopbackAddress()
                    && !address.isLinkLocalAddress() && !address.isAnyLocalAddress()) {
                addresses.add(address.getHostAddress());
            }
        }
    }
}
