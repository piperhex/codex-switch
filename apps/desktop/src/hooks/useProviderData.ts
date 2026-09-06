import { useEffect, useRef, useState } from "react";
import {
  loadAggregateApis,
  loadLocalProxyStatus,
  loadProviders,
  subscribeToProviderEvents,
} from "../api/backend";
import type { AggregateApi, Provider } from "../types";
import { ProviderDataController, type ProviderDataSnapshot } from "./providerDataController";

const EMPTY_PROVIDERS: Provider[] = [];
const EMPTY_AGGREGATES: AggregateApi[] = [];

export function useProviderData(notify: (message: string) => void) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [snapshot, setSnapshot] = useState<ProviderDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [controller] = useState(() => new ProviderDataController({
    loadProviders,
    loadAggregateApis,
    loadLocalProxyStatus,
    onSnapshot: setSnapshot,
    onLocalProxyStatus: (localProxy) => setSnapshot((current) => ({
      providers: current?.providers ?? [],
      aggregateApis: current?.aggregateApis ?? [],
      localProxy,
    })),
    onError: (error) => notifyRef.current(String(error)),
    onSettled: () => setLoading(false),
  }));

  useEffect(() => {
    controller.activate();
    const unsubscribe = subscribeToProviderEvents(controller.refresh);
    void controller.refresh();
    return () => {
      controller.dispose();
      unsubscribe();
    };
  }, [controller]);

  return {
    providers: snapshot?.providers ?? EMPTY_PROVIDERS,
    aggregateApis: snapshot?.aggregateApis ?? EMPTY_AGGREGATES,
    localProxy: snapshot?.localProxy ?? null,
    loading,
    load: controller.refresh,
    setLocalProxy: controller.acceptLocalProxyStatus,
  };
}
