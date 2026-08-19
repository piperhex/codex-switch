import { useCallback, useEffect, useState } from "react";
import { testProviderConnectivity } from "../../api/backend";

const MAX_CONCURRENT_TESTS = 4;

export type ProviderConnectivityErrors = Record<string, string>;

function connectivityErrorMessage(error: unknown) {
  return String(error).replace(/^Error:\s*/, "");
}

async function collectConnectivityErrors(ids: string[]) {
  const errors: ProviderConnectivityErrors = {};
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex];
      nextIndex += 1;
      try {
        await testProviderConnectivity(id);
      } catch (error) {
        errors[id] = connectivityErrorMessage(error);
      }
    }
  };
  const workerCount = Math.min(MAX_CONCURRENT_TESTS, ids.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return errors;
}

export function useProviderConnectivity(providerIds: string[]) {
  const [errors, setErrors] = useState<ProviderConnectivityErrors>({});
  const [testing, setTesting] = useState(false);
  const providerIdKey = providerIds.join("\0");

  useEffect(() => {
    const availableIds = new Set(providerIds);
    setErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => availableIds.has(id)),
    ));
  }, [providerIdKey]);

  const testMany = useCallback(async (ids: string[]) => {
    if (!ids.length || testing) return;
    const testedIds = new Set(ids);
    setTesting(true);
    setErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => !testedIds.has(id)),
    ));
    try {
      const failures = await collectConnectivityErrors(ids);
      setErrors((current) => ({ ...current, ...failures }));
    } finally {
      setTesting(false);
    }
  }, [testing]);

  return { errors, testing, testMany };
}
