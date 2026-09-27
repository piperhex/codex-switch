package com.oney.WebRTCModule;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** JVM regression tests: run with scripts/test-webrtc-ice.cjs, without an Android device. */
public final class IceCandidateAddressTest {
    private static final String CANDIDATE =
            "candidate:1 1 udp 2122260223 172.19.0.1 50000 typ host generation 0 ufrag test network-id 4";
    private static final Set<String> VPN = Set.of("172.19.0.1");
    private static final Set<String> LAN = Set.of("192.168.5.187");

    public static void main(String[] args) {
        equal(IceCandidateAddress.repair(CANDIDATE, VPN, LAN),
                CANDIDATE.replace("172.19.0.1", "192.168.5.187"));
        for (String unchanged : List.of(CANDIDATE.replace("host", "srflx"),
                CANDIDATE.replace("host", "relay"), CANDIDATE.replace("udp", "tcp"),
                CANDIDATE.replace("172.19.0.1", "192.168.5.187"),
                CANDIDATE.replace("172.19.0.1", "peer.local"), "malformed")) {
            equal(IceCandidateAddress.repair(unchanged, VPN, LAN), unchanged);
        }
        equal(IceCandidateAddress.repair(CANDIDATE, Set.of(), LAN), CANDIDATE);
        equal(IceCandidateAddress.repair(CANDIDATE, VPN, Set.of()), CANDIDATE);
        equal(IceCandidateAddress.repair(CANDIDATE, VPN, Set.of("192.168.5.187", "192.168.6.2")), CANDIDATE);
        equal(IceCandidateAddress.repair(CANDIDATE, VPN, Set.of("2001:db8::1")), CANDIDATE);
        String ipv6 = CANDIDATE.replace("172.19.0.1", "fd00::1");
        equal(IceCandidateAddress.repair(ipv6, Set.of("fd00::1"), LAN), ipv6);
        equal(type(CANDIDATE, stats("wifi", false, 50000)), "wifi");
        equal(type(CANDIDATE, stats("ethernet", false, 50000)), "ethernet");
        equal(type(CANDIDATE, stats("vpn", true, 50000)), "");
        equal(type(CANDIDATE, stats("wifi", true, 50000)), "");
        equal(type(CANDIDATE, stats("cellular", false, 50000)), "");
        equal(type(CANDIDATE, stats("wifi", false, 50001)), "");
        equal(type(CANDIDATE.replace("2122260223", "2122194687"), stats("wifi", false, 50000)), "");
        equal(type(CANDIDATE.replace("50000", "invalid"), stats("wifi", false, 50000)), "");
        equal(type("malformed", stats("wifi", false, 50000)), "");
        equal(IceCandidateAddress.physicalNetworkType(CANDIDATE, List.of()), "");
        equal(IceCandidateAddress.physicalNetworkType(CANDIDATE,
                List.of(stats("wifi", false, 50000), stats("vpn", true, 50000))), "");
        System.out.println("ICE address regression checks passed");
    }

    private static String type(String sdp, Map<String, Object> stats) {
        return IceCandidateAddress.physicalNetworkType(sdp, List.of(stats));
    }

    private static Map<String, Object> stats(String type, boolean vpn, long port) {
        return Map.of("address", "172.19.0.1", "port", port, "priority", 2122260223L,
                "protocol", "udp", "candidateType", "host", "networkType", type, "vpn", vpn);
    }

    private static void equal(String actual, String expected) {
        if (!actual.equals(expected)) throw new AssertionError("Expected " + expected + "; got " + actual);
    }
}
