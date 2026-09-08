import { Button, Tooltip } from "antd";
import { ArrowUp, Play, Square } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState } from "./types";

const CONTINUE_MESSAGE = "请继续完成刚才中断的任务。";

export function ComposerSubmit({ state, controller, hasDraft, reading, onSend }: {
  state: GuiState;
  controller: GuiController;
  hasDraft: boolean;
  reading: boolean;
  onSend: () => Promise<void>;
}) {
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const interrupted = current?.turns[current.turns.length - 1]?.status === "interrupted";
  const continuing = interrupted && !hasDraft;
  const disabled = state.connection !== "ready" || state.sending || state.archived || reading;
  const submit = async () => {
    if (disabled || current?.activeTurn) return;
    if (continuing) await controller.send(CONTINUE_MESSAGE, []);
    else if (hasDraft) await onSend();
  };

  if (current?.activeTurn) return <Button type="primary" shape="circle"
    icon={<Square size={14} fill="currentColor" />} aria-label="停止生成"
    onClick={() => void controller.interrupt()} />;

  return <Tooltip title={continuing ? "继续生成" : "发送消息"} styles={{ root: { maxWidth: 400 } }}>
    <Button type="primary" shape="circle"
      icon={continuing ? <Play size={17} fill="currentColor" /> : <ArrowUp size={19} />}
      aria-label={continuing ? "继续生成" : "发送消息"} loading={state.sending}
      disabled={disabled || (!hasDraft && !continuing)} onClick={() => void submit()} />
  </Tooltip>;
}
