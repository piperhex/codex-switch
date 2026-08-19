import { useEffect, useRef, useState } from "react";
import { detectRelayPlatform } from "../../api/backend";
import type { Provider, ProviderBalancePlatform } from "../../types";
import { defaultBalanceUrl, defaultWalletUrl } from "./providerUtils";

export type DetectionState = "idle" | "detecting" | "detected" | "notFound";

interface UseProviderBalanceDetectionOptions {
  provider: Provider | null;
  baseUrl: string;
  apiKey: string;
}

export function useProviderBalanceDetection({
  provider,
  baseUrl,
  apiKey,
}: UseProviderBalanceDetectionOptions) {
  const [balancePlatform, setBalancePlatform] = useState<ProviderBalancePlatform | null>(null);
  const [detectionState, setDetectionState] = useState<DetectionState>("idle");
  const [balanceQueryUrl, setBalanceQueryUrl] = useState("");
  const [balanceQueryUrlTouched, setBalanceQueryUrlTouched] = useState(false);
  const [balanceQueryUsesApiKey, setBalanceQueryUsesApiKey] = useState(true);
  const [balanceQueryToken, setBalanceQueryToken] = useState("");
  const [walletQueryUrl, setWalletQueryUrl] = useState("");
  const [walletQueryUrlTouched, setWalletQueryUrlTouched] = useState(false);
  const [walletQueryToken, setWalletQueryToken] = useState("");
  const [walletUsername, setWalletUsername] = useState("");
  const [walletPassword, setWalletPassword] = useState("");
  const detectionRequestId = useRef(0);

  useEffect(() => {
    setBalancePlatform(provider?.balancePlatform ?? null);
    setDetectionState(provider?.balancePlatform ? "detected" : "idle");
    setBalanceQueryUrl(provider?.balanceQueryUrl ?? "");
    setBalanceQueryUrlTouched(false);
    setBalanceQueryUsesApiKey(provider?.balanceQueryUsesApiKey ?? true);
    setBalanceQueryToken("");
    setWalletQueryUrl(provider?.walletQueryUrl
      ?? (provider?.balancePlatform ? defaultWalletUrl(provider.baseUrl, provider.balancePlatform) : ""));
    setWalletQueryUrlTouched(false);
    setWalletQueryToken("");
    setWalletUsername(provider?.walletUsername ?? "");
    setWalletPassword("");
  }, [provider]);

  useEffect(() => {
    detectionRequestId.current += 1;
    const requestId = detectionRequestId.current;
    const url = baseUrl.trim();
    const token = apiKey.trim();
    if (!url || !token) {
      setDetectionState(provider?.balancePlatform ? "detected" : "idle");
      return;
    }
    setDetectionState("detecting");
    const timer = window.setTimeout(() => {
      void detectPlatform(url, token, requestId);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [apiKey, baseUrl, provider]);

  useEffect(() => {
    if (!balancePlatform) return;
    if (!balanceQueryUrlTouched) setBalanceQueryUrl(defaultBalanceUrl(baseUrl, balancePlatform));
    if (!walletQueryUrlTouched) setWalletQueryUrl(defaultWalletUrl(baseUrl, balancePlatform));
  }, [balancePlatform, baseUrl, balanceQueryUrlTouched, walletQueryUrlTouched]);

  async function detectPlatform(url: string, token: string, requestId: number) {
    try {
      const detected = await detectRelayPlatform(url, token);
      if (requestId !== detectionRequestId.current) return;
      setBalancePlatform(detected);
      setDetectionState(detected ? "detected" : "notFound");
    } catch {
      if (requestId !== detectionRequestId.current) return;
      setBalancePlatform(null);
      setDetectionState("notFound");
    }
  }

  async function resolvePlatform() {
    if (balancePlatform || !baseUrl.trim() || !apiKey.trim()) return balancePlatform;
    try {
      const detected = await detectRelayPlatform(baseUrl, apiKey);
      if (detected) {
        setBalancePlatform(detected);
        setDetectionState("detected");
      }
      return detected;
    } catch {
      return null;
    }
  }

  return {
    balancePlatform,
    balanceQueryToken,
    balanceQueryUrl,
    balanceQueryUsesApiKey,
    detectionState,
    resolvePlatform,
    updateBalanceQueryUrl: (value: string) => {
      setBalanceQueryUrlTouched(true);
      setBalanceQueryUrl(value);
    },
    setBalanceQueryToken,
    setBalanceQueryUsesApiKey,
    updateWalletQueryUrl: (value: string) => {
      setWalletQueryUrlTouched(true);
      setWalletQueryUrl(value);
    },
    setWalletQueryToken,
    setWalletPassword,
    setWalletUsername,
    walletPassword,
    walletQueryToken,
    walletQueryUrl,
    walletUsername,
  };
}
