import { useEffect, useRef, useState } from 'react';
import type { GuiAccountsClient, GuiAccountsSnapshot, SelectableGuiAccount } from '../guiAccounts';

function readError(error: unknown) {
  if (error instanceof Error && error.message.includes('暂不支持')) return '请更新电脑端 Codex Switch 后重试。';
  return '暂时无法读取电脑的账户，请重试。';
}

export function useGuiAccounts(client: GuiAccountsClient, active: boolean) {
  const [snapshot, setSnapshot] = useState<GuiAccountsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const switching = useRef(false);
  const generation = useRef(0);
  const refresh = useRef(() => {});

  useEffect(() => {
    const epoch = ++generation.current;
    setSnapshot(null); setError(''); setLoading(active);
    if (!active) return;
    let disposed = false;
    let reading = false;
    let queued = false;
    let revision = 0;
    const read = () => {
      const request = ++revision;
      if (reading) { queued = true; return; }
      reading = true; queued = false; setLoading(true);
      void client.read().then((next) => {
        if (!disposed && request === revision) { setSnapshot(next); setError(''); }
      }).catch((reason: unknown) => {
        if (!disposed && request === revision) setError(readError(reason));
      }).finally(() => {
        reading = false;
        if (disposed) return;
        if (queued) read();
        else setLoading(false);
      });
    };
    refresh.current = read;
    const stop = client.subscribe(read);
    read();
    return () => {
      disposed = true; stop(); refresh.current = () => {};
      if (generation.current === epoch) generation.current++;
    };
  }, [client, active]);

  const select = async (selection: SelectableGuiAccount) => {
    if (!active || !snapshot?.running || switching.current || loading) return false;
    const choice = snapshot.choices.find((entry) => entry.kind === selection.kind && entry.id === selection.id);
    if (!choice?.available) return false;
    const epoch = generation.current;
    switching.current = true; setSaving(`${selection.kind}:${selection.id}`); setError('');
    try {
      await client.select(selection);
      if (epoch !== generation.current) return false;
      // Another client may switch again before the acknowledgement reaches this phone.
      refresh.current();
      return true;
    } catch {
      if (epoch === generation.current) setError('切换未完成，请重试。');
      return false;
    } finally { switching.current = false; setSaving(null); }
  };
  return { snapshot, loading, error, saving, select, refresh: () => refresh.current() };
}
