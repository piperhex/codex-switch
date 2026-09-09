import { useContext, useEffect, useRef, useState } from "react";
import { Popconfirm } from "antd";
import { Undo2 } from "lucide-react";
import { DiffView } from "./DiffView";
import type { DiffFile } from "./diff";
import { gitApi } from "./gitApi";
import styles from "./EditedFilesSummary.module.less";
import { WorkspaceOperationContext } from "./workspaceOperationContext";

export function TurnDiff({ files, title, threadId, turnId, disabled }: {
  files: DiffFile[]; title: string; threadId?: string; turnId: string; disabled: boolean;
}) {
  const [undone, setUndone] = useState(false);
  const workspace = useContext(WorkspaceOperationContext);
  disabled = disabled || workspace.busy;
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(Boolean(threadId));
  const [error, setError] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setChecking(true);
    gitApi.undo({ threadId, turnId, checkOnly: true }).then((result) => {
      if (!cancelled) setUndone(result.undone);
    }).catch(() => {
      if (!cancelled) setError("暂时无法读取撤销记录，点击撤销时会重新检查。");
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [threadId, turnId]);
  const undo = async () => {
    if (!threadId || disabled || flight.current || checking || undone) return;
    flight.current = true; setBusy(true); setError(""); workspace.setBusy(true);
    try { setUndone((await gitApi.undo({ threadId, turnId })).undone); }
    catch (error) { setError(String(error)); }
    finally { flight.current = false; setBusy(false); workspace.setBusy(false); }
  };
  const action = threadId && <Popconfirm title="撤销本轮修改？"
    description="将恢复本轮修改前的内容。若有冲突，撤销会停止。"
    okText="撤销修改" cancelText="取消" disabled={disabled || checking || busy || undone}
    onConfirm={undo} styles={{ root: { maxWidth: 400 } }}>
    <button type="button" className={styles.undo} disabled={disabled || checking || busy || undone}
      aria-label="撤销本轮修改"><span>{busy ? "正在撤销…" : undone ? "已撤销" : "撤销"}</span><Undo2 size={16} /></button>
  </Popconfirm>;
  return <>
    <DiffView files={files} title={title} status={undone ? "已撤销" : undefined} undo={action} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </>;
}
