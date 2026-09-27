package com.oney.WebRTCModule;

import java.util.Collection;
import java.util.Map;
import java.util.Set;

/** Repairs M124's default-interface address substitution, without inventing network addresses. */
final class IceCandidateAddress {
    private static final int ADDRESS_INDEX = 4;
    private static final int MIN_FIELDS = 8;

    private IceCandidateAddress() {}

    static String physicalNetworkType(String sdp, Collection<Map<String, Object>> candidates) {
        String[] fields = sdp.trim().split("\\s+");
        if (fields.length < MIN_FIELDS) return "";
        String physicalType = "";
        boolean matched = false;
        for (Map<String, Object> candidate : candidates) {
            if (!matches(fields, candidate)) continue;
            if (matched || Boolean.TRUE.equals(candidate.get("vpn"))) return "";
            matched = true;
            Object type = candidate.get("networkType");
            physicalType = "wifi".equals(type) || "ethernet".equals(type) ? (String) type : "";
        }
        return physicalType;
    }

    private static boolean matches(String[] fields, Map<String, Object> candidate) {
        if (!fields[ADDRESS_INDEX].equals(candidate.get("address"))
                || !fields[2].equalsIgnoreCase(String.valueOf(candidate.get("protocol")))
                || !"host".equals(candidate.get("candidateType"))) return false;
        Object port = candidate.get("port");
        Object priority = candidate.get("priority");
        try {
            return port instanceof Number && priority instanceof Number
                    && ((Number) port).longValue() == Long.parseLong(fields[5])
                    && ((Number) priority).longValue() == Long.parseLong(fields[3]);
        } catch (NumberFormatException error) {
            return false;
        }
    }

    static String repair(String sdp, Set<String> vpnAddresses, Set<String> physicalAddresses) {
        String[] fields = sdp.trim().split("\\s+");
        if (fields.length < MIN_FIELDS || !fields[0].startsWith("candidate:")
                || !fields[2].equalsIgnoreCase("udp") || !fields[6].equals("typ")
                || !fields[7].equals("host") || !vpnAddresses.contains(fields[ADDRESS_INDEX])
                || physicalAddresses.size() != 1) {
            return sdp;
        }
        String address = physicalAddresses.iterator().next();
        if (address.contains(":") || fields[ADDRESS_INDEX].contains(":")) return sdp;
        fields[ADDRESS_INDEX] = address;
        // String.join requires API 26; the app also supports Android API 24 and 25.
        StringBuilder repaired = new StringBuilder(fields[0]);
        for (int index = 1; index < fields.length; index++) repaired.append(' ').append(fields[index]);
        return repaired.toString();
    }
}
