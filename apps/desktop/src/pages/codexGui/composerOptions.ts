import { guiText } from "../../i18n/guiText";
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
  | { kind: "conversation"; key: string; label: string; description: string; enabled: boolean; command: GoalCommand }
  | { kind: "goal"; key: string; label: string; description: string; enabled: boolean; command: GoalCommand }
  | { kind: "compact"; key: string; label: string; description: string; enabled: boolean; command: CompactCommand }
  | { kind: "skill"; key: string; label: string; description: string; enabled: boolean; skill: Skill };

export interface GoalCommand { enabled: boolean; run: () => void }

export function compactUnavailableReason(state: GuiState): string | null {
  const id = state.selected;
  if (state.connection !== "ready") return guiText("连接后即可压缩");
  if (!id || !state.conversations[id]) return guiText("开始对话后即可压缩");
  if (state.archived) return guiText("恢复对话后即可压缩");
  if (state.compacting) return guiText("正在压缩上下文…");
  if (state.sending || state.deleting || state.conversations[id].activeTurn
    || state.approvals.some((event) => event.params.threadId === id)) return guiText("请等待当前任务结束");
  if (state.queued[id]?.length) return guiText("请先处理待发送消息");
  return null;
}

export function compactCommand(state: GuiState, run: () => void): CompactCommand {
  const usage = state.selected ? state.conversations[state.selected]?.tokenUsage : undefined;
  const percent = contextUsage(usage)?.percent ?? null;
  const reason = compactUnavailableReason(state);
  const description = percent === null ? guiText("压缩此对话的上下文") : guiText("压缩此对话的上下文（已使用 {value1}%）", { value1: percent });
  return { enabled: reason === null, description: reason ?? description, percent, run };
}

export function composerOptions(skills: Skill[], query: string, command?: CompactCommand,
  goal?: GoalCommand): ComposerOption[] {
  const options: ComposerOption[] = [...(command ? [{ kind: "compact" as const, key: "compact", label: guiText("压缩"),
    description: command.description, enabled: command.enabled, command }] : []),
  ...(goal ? [{ kind: "goal" as const, key: "goal", label: guiText("目标 /goal"),
    description: guiText("持续推进，直到完成目标"), enabled: goal.enabled, command: goal }] : []),
  ...skills.map((skill): ComposerOption => ({ kind: "skill", key: skill.path, label: skillLabel(skill),
    description: skillDescription(skill), enabled: skill.enabled, skill }))];
  return options.filter((option) => {
    const name = option.kind === "skill" ? option.skill.name
      : { compact: guiText("compact 压缩 上下文"), goal: guiText("goal 目标"), conversation: guiText("对话") }[option.kind];
    return `${name} ${option.label} ${option.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
}
