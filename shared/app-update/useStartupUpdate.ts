import { useCallback, useEffect, useRef, useState } from 'react';

export interface StartupRelease {
  version: string;
}

export interface StartupUpdateOptions<Release extends StartupRelease> {
  check: () => Promise<Release | null>;
  readIgnoredVersion: () => Promise<string | null>;
  writeIgnoredVersion: (version: string) => Promise<void>;
}

/** Check once per app mount, including React Strict Mode's effect replay. */
export function useStartupUpdate<Release extends StartupRelease>(options: StartupUpdateOptions<Release>) {
  const [release, setRelease] = useState<Release | null>(null);
  const request = useRef<Promise<Release | null> | null>(null);
  const ignoring = useRef(false);

  useEffect(() => {
    let active = true;
    request.current ??= Promise.all([
      options.check(),
      options.readIgnoredVersion().catch(() => null),
    ]).then(([latest, ignored]) => latest?.version === ignored ? null : latest);
    void request.current.then((latest) => {
      if (active) setRelease(latest);
    }).catch(() => {
      // A startup check must remain quiet when offline; the next launch checks again.
    });
    return () => { active = false; };
  }, [options]);

  const dismiss = useCallback(() => setRelease(null), []);
  const ignoreVersion = useCallback(async () => {
    if (!release || ignoring.current) return;
    ignoring.current = true;
    try {
      await options.writeIgnoredVersion(release.version);
      dismiss();
    } finally {
      ignoring.current = false;
    }
  }, [dismiss, options, release]);

  return { release, dismiss, ignoreVersion };
}
