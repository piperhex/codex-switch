import { contextUsage } from "./contextUsage";
import { skillDescription, skillLabel } from "./skillEditorDom";
import type { GuiState, Skill } from "./types";

export interface CompactCommand {
  enabled: boolean;
  description: string;
  percent: number | null;
  run: () => void;
}
export type ComposerOption =
  | { kind: "compact"; key: string; label: string; description: string; enabled: boolean; command: CompactCommand }
  | { kind: "skill"; key: string; label: string; description: string; enabled: boolean; skill: Skill };

export function compactUnavailableReason(state: GuiState): string | null {
  const id = state.selected;
  if (state.connection !== "ready") return "连接后即可压缩";
  if (!id || !state.conversations[id]) return "开始对话后即可压缩";
  if (state.archived) return "恢复对话后即可压缩";
  if (state.compacting) return "正在压缩上下文…";
  if (state.sending || state.deleting || state.conversations[id].activeTurn
    || state.approvals.some((event) => event.params.threadId === id)) return "请等待当前任务结束";
  if (state.queued[id]?.length) return "请先处理待发送消息";
  return null;
}

export function compactCommand(state: GuiState, run: () => void): CompactCommand {
  const usage = state.selected ? state.conversations[state.selected]?.tokenUsage : undefined;
  const percent = contextUsage(usage)?.percent ?? null;
  const reason = compactUnavailableReason(state);
  const description = percent === null ? "压缩此对话的上下文" : `压缩此对话的上下文（已使用 ${percent}%）`;
  return { enabled: reason === null, description: reason ?? description, percent, run };
}

export function composerOptions(skills: Skill[], query: string, command: CompactCommand): ComposerOption[] {
  const options: ComposerOption[] = [{ kind: "compact", key: "compact", label: "压缩",
    description: command.description, enabled: command.enabled, command },
  ...skills.map((skill): ComposerOption => ({ kind: "skill", key: skill.path, label: skillLabel(skill),
    description: skillDescription(skill), enabled: skill.enabled, skill }))];
  return options.filter((option) => {
    const name = option.kind === "compact" ? "compact 压缩 上下文" : option.skill.name;
    return `${name} ${option.label} ${option.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
}
