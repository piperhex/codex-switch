import { useEffect, useState } from "react";
import { Alert, Button, Input, Modal } from "antd";
import { GOAL_STATUS } from "./goalTypes";
import type { GuiController } from "./controller";
import type { GuiState } from "./types";
import styles from "./ComposerExtras.module.less";

export function GoalDialog({ state, controller, onClose }: {
  state: GuiState; controller: GuiController; onClose: () => void;
}) {
  const id = state.selected;
  const goal = id ? state.goals?.[id] : null;
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [edited, setEdited] = useState(false);
  useEffect(() => { if (!edited) setObjective(goal?.objective ?? ""); }, [goal?.objective, edited]);
  const busy = Boolean(state.goalBusy || state.sending);
  const running = Boolean(id && state.conversations[id]?.activeTurn);
  const unavailable = state.connection !== "ready" || state.archived || busy;
  const blocked = running || Boolean(state.compacting || (id && state.queued[id]?.length)
    || state.approvals.some((event) => event.params.threadId === id));
  const save = async () => {
    if (await controller.goals.set({ objective, status: "active" })) onClose();
  };
  const pause = async () => {
    if (!id) return;
    if (await controller.goals.set({ threadId: id, status: "paused" })) onClose();
  };
  const error = id ? state.goalErrors?.[id] : undefined;
  return <Modal open centered title={goal ? "管理目标" : "设置目标"} width={400}
    onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<div className={styles.goalActions}>
      {goal && <Button danger type="text" disabled={unavailable || running}
        onClick={async () => { if (id && await controller.goals.clear(id)) onClose(); }}>移除目标</Button>}
      <Button disabled={busy} onClick={onClose}>取消</Button>
      {goal?.status === "active" && <Button disabled={unavailable} onClick={() => void pause()}>暂停目标</Button>}
      <Button type="primary" loading={busy} disabled={unavailable || blocked || !objective.trim()}
        onClick={() => void save()}>{goal ? "保存并继续" : "开始目标"}</Button>
    </div>}>
    <p className={styles.copy}>描述想完成的结果。Codex 会持续推进，直到完成目标或需要你的协助。</p>
    {goal && <div className={styles.goalStatus}>{GOAL_STATUS[goal.status]}
      <span>已用 {goal.tokensUsed.toLocaleString()} tokens · {Math.floor(goal.timeUsedSeconds / 60)} 分钟</span>
    </div>}
    <Input.TextArea autoFocus aria-label="目标" placeholder="例如：完成登录页面，并验证登录和退出流程"
      value={objective} maxLength={4000} autoSize={{ minRows: 4, maxRows: 8 }} disabled={unavailable || running}
      onChange={(event) => { setObjective(event.target.value); setEdited(true); }} />
    {blocked && <p className={styles.copy}>请先等待当前任务结束，并处理待发送消息或确认请求，再开始或修改目标。</p>}
    {error && <Alert type="warning" className={styles.goalError} message={error}
      action={<Button size="small" onClick={() => { if (id) void controller.goals.load(id); }}>重试</Button>} />}
  </Modal>;
}
