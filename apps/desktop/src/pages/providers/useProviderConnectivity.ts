import { useCallback, useEffect, useRef, useState } from "react";
import { testProviderConnectivity } from "../../api/backend";

const MAX_CONCURRENT_TESTS = 4;
const SUCCESS_DISPLAY_DURATION_MS = 60_000;

export type ProviderConnectivityErrors = Record<string, string>;
export type ProviderConnectivitySuccesses = Record<string, true>;

function connectivityErrorMessage(error: unknown) {
  return String(error).replace(/^Error:\s*/, "");
}

async function collectConnectivityResults(ids: string[]) {
  const errors: ProviderConnectivityErrors = {};
  const successes: ProviderConnectivitySuccesses = {};
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex];
      nextIndex += 1;
      try {
        await testProviderConnectivity(id);
        successes[id] = true;
      } catch (error) {
        errors[id] = connectivityErrorMessage(error);
      }
    }
  };
  const workerCount = Math.min(MAX_CONCURRENT_TESTS, ids.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { errors, successes };
}

export function useProviderConnectivity(providerIds: string[]) {
  const [errors, setErrors] = useState<ProviderConnectivityErrors>({});
  const [successes, setSuccesses] = useState<ProviderConnectivitySuccesses>({});
  const [testing, setTesting] = useState(false);
  const successTimers = useRef(new Map<string, number>());
  const providerIdKey = providerIds.join("\0");

  useEffect(() => {
    const availableIds = new Set(providerIds);
    setErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => availableIds.has(id)),
    ));
    setSuccesses((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => availableIds.has(id)),
    ));
    successTimers.current.forEach((timer, id) => {
      if (availableIds.has(id)) return;
      window.clearTimeout(timer);
      successTimers.current.delete(id);
    });
  }, [providerIdKey]);

  useEffect(() => () => {
    successTimers.current.forEach((timer) => window.clearTimeout(timer));
    successTimers.current.clear();
  }, []);

  const clearSuccessTimers = useCallback((ids: string[]) => {
    ids.forEach((id) => {
      const timer = successTimers.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      successTimers.current.delete(id);
    });
  }, []);

  const scheduleSuccessRemoval = useCallback((ids: string[]) => {
    ids.forEach((id) => {
      const timer = window.setTimeout(() => {
        setSuccesses((current) => {
          if (!current[id]) return current;
          const { [id]: _removed, ...remaining } = current;
          return remaining;
        });
        successTimers.current.delete(id);
      }, SUCCESS_DISPLAY_DURATION_MS);
      successTimers.current.set(id, timer);
    });
  }, []);

  const testMany = useCallback(async (ids: string[]) => {
    if (!ids.length || testing) return;
    const testedIds = new Set(ids);
    setTesting(true);
    clearSuccessTimers(ids);
    setErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !testedIds.has(id)),
    ));
    setSuccesses((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !testedIds.has(id)),
    ));
    try {
      const results = await collectConnectivityResults(ids);
      setErrors((current) => ({ ...current, ...results.errors }));
      setSuccesses((current) => ({ ...current, ...results.successes }));
      scheduleSuccessRemoval(Object.keys(results.successes));
    } finally {
      setTesting(false);
    }
  }, [clearSuccessTimers, scheduleSuccessRemoval, testing]);

  return { errors, successes, testing, testMany };
}
