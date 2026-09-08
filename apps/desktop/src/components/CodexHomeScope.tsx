import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Empty, Select, Spin } from "antd";
import { loadAppSettings } from "../api/backend";
import { DEFAULT_CODEX_HOME_ID, GUI_CODEX_HOME_ID, type CodexHomeEntry } from "../types";
import styles from "./CodexHomeScope.module.less";

interface HomeScope {
  homeId: string;
  homes: CodexHomeEntry[];
  select: (id: string) => void;
}

const HomeContext = createContext<HomeScope | null>(null);

function useHomeScope() {
  const scope = useContext(HomeContext);
  if (!scope) throw new Error("Codex Home selection is unavailable");
  return scope;
}

export function useSelectedCodexHome() {
  return useHomeScope().homeId;
}

export function CodexHomeScope({ active = true, children }: { active?: boolean; children: ReactNode }) {
  const [homes, setHomes] = useState<CodexHomeEntry[]>([]);
  const [selected, select] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError("");
    void loadAppSettings().then((settings) => {
      if (cancelled) return;
      setHomes(settings.codexHomes ?? []);
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) setError("无法读取目录列表，请重试。");
    });
    return () => { cancelled = true; };
  }, [active, attempt]);
  const home = homes.find((entry) => entry.id === selected)
    ?? homes.find((entry) => entry.enabled) ?? homes[0];
  if (error) return <Alert className={styles.notice} type="error" message={error}
    action={<Button size="small" onClick={() => retry((value) => value + 1)}>重试</Button>} />;
  if (!loaded) return <Spin className={styles.loading} />;
  if (!home) return <Empty description="请先在设置中添加 Codex Home。" />;
  return <HomeContext.Provider key={`${home.id}:${home.path}`} value={{ homeId: home.id, homes, select }}>
    {children}
  </HomeContext.Provider>;
}

export function CodexHomeSelect({ disabled = false }: { disabled?: boolean }) {
  const { homes, homeId, select } = useHomeScope();
  return <label className={styles.selector}>
    <span>Codex Home</span>
    <Select aria-label="选择管理的 Codex Home" value={homeId} onChange={select} disabled={disabled}
      popupClassName={styles.popup} popupMatchSelectWidth={false}
      options={homes.map((home) => ({ value: home.id, label: homeLabel(home) }))} />
  </label>;
}

function homeLabel(home: CodexHomeEntry) {
  if (home.id === GUI_CODEX_HOME_ID) return `内置 Codex GUI · ${home.path}`;
  if (home.id === DEFAULT_CODEX_HOME_ID) return `默认目录 · ${home.path}`;
  return home.path;
}
