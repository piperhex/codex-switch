import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Target } from "lucide-react";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { ComposerFilesDialog } from "./ComposerFilesDialog";
import { ComposerReferences } from "./ComposerReferences";
import { ComposerQuotes } from "./ComposerQuotes";
import type { ReplyQuote } from "./replyQuotes";
import { GoalDialog } from "./GoalDialog";
import { GOAL_STATUS } from "./goalTypes";
import extras from "./ComposerExtras.module.less";
import { AccessPicker } from "./AccessPicker";
import { ComposerSubmit } from "./ComposerSubmit";
import type { GuiController } from "./controller";
import type { AccessMode, GuiState } from "./types";
import { ImageAttachments } from "./ImageAttachments";
import { IMAGE_TYPES, useComposerDraft } from "./useComposerDraft";
import { ModelPicker } from "./ModelPicker";
import { UsageStatus } from "./UsageStatus";
import { ProjectPicker } from "./ProjectPicker";
import { SkillInput, type SkillInputHandle } from "./SkillInput";
import { compactCommand } from "./composerOptions";
import { QueuedMessages } from "./QueuedMessages";
import styles from "./styles.module.less";

export interface ComposerHandle { addQuote: (quote: ReplyQuote) => boolean }

const TOKENS_PER_THOUSAND = 1_000;
const TOKENS_PER_MILLION = 1_000_000;
const TOKEN_DECIMAL_PLACES = 2;

function formatConversationTokens(value: number) {
  if (value >= TOKENS_PER_MILLION) return `${(value / TOKENS_PER_MILLION).toFixed(TOKEN_DECIMAL_PLACES)}M`;
  if (value >= TOKENS_PER_THOUSAND) return `${(value / TOKENS_PER_THOUSAND).toFixed(TOKEN_DECIMAL_PLACES)}k`;
  return value.toLocaleString();
}

export const Composer = forwardRef<ComposerHandle, {
  state: GuiState; controller: GuiController; active: boolean;
}>(function Composer({ state, controller, active }, ref) {
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const skillInput = useRef<SkillInputHandle>(null);
  const key = state.selected ?? "new";
  const [dialog, setDialog] = useState<"files" | "goal" | null>(null);
  const workspaceBusy = Boolean(state.workspaceBusy);
  const { draft, reading, editContent, removeImage, addImages, paste, send: sendDraft,
    addAttachments, removeAttachment, addQuote, removeQuote, clearQuotes, editQueued } = useComposerDraft(key, controller);
  // Creating a goal first creates its conversation; keep the form until the goal request succeeds.
  useEffect(() => { if (!controller.getSnapshot().goalBusy || !active) setDialog(null); }, [key, active, controller]);
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const project = state.selected
    ? state.projectOverrides[state.selected] ?? current?.thread.cwd ?? "" : state.settings.cwd;
  const running = Boolean(current?.activeTurn);
  const queuedMessages = state.selected ? state.queued[state.selected] ?? [] : [];
  const attachedQueue = running && queuedMessages.length > 0;
  const disabled = workspaceBusy || state.connection !== "ready" || state.sending || state.archived
    || state.compacting === state.selected;
  const hasDraft = Boolean(draft.text.trim() || draft.images.length
    || draft.attachments?.length || draft.quotes?.length);
  useImperativeHandle(ref, () => ({ addQuote: (quote) => {
    if (disabled || !active || !current?.turns.some((turn) => turn.items.some((item) =>
      item.id === quote.messageId && item.type === "agentMessage"))) return false;
    if (!addQuote(quote)) return false;
    skillInput.current?.focus();
    return true;
  } }));
  const goal = state.selected ? state.goals?.[state.selected] : null;
  const canSend = !disabled && !reading
    && hasDraft;
  const send = async () => {
    if (!canSend) return;
    await sendDraft();
  };
  const editQueuedMessage = (id: string) => {
    if (disabled || reading || !active) return;
    let restored = false;
    flushSync(() => { restored = editQueued(id); });
    if (restored) skillInput.current?.focus();
  };
  return <div className={styles.composerWrap}>
    {state.selected && <QueuedMessages threadId={state.selected} messages={queuedMessages}
      running={running} connected={state.connection === "ready"} queue={controller.queue}
      editDisabled={disabled || reading || !active} onEdit={editQueuedMessage} />}
    {!running && <ProjectPicker key={key} value={project} projects={state.projects}
      disabled={state.sending || state.archived || workspaceBusy} gitEnabled={!state.selected}
      onBusyChange={controller.setWorkspaceBusy}
      onChange={controller.setProject} onError={controller.report} />}
    <div ref={composer} className={`${styles.composer} ${attachedQueue ? styles.composerAttached : ""}`}>
      <ImageAttachments key={key} images={draft.images} active={active}
        disabled={state.sending} onRemove={removeImage} />
      <ComposerReferences items={draft.attachments ?? []} disabled={disabled} onRemove={removeAttachment} />
      <ComposerQuotes quotes={draft.quotes ?? []} draftKey={key} active={active} disabled={disabled}
        onRemove={removeQuote} onClear={() => { clearQuotes(); skillInput.current?.focus(); }} />
      {goal && <button type="button" className={extras.goalChip} onClick={() => setDialog("goal")}>
        <Target size={15} /><span>{goal.objective}</span><small>{GOAL_STATUS[goal.status]}</small>
      </button>}
      <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden disabled={disabled}
        aria-label="选择图片" onChange={(event) => {
          addImages(Array.from(event.target.files ?? [])); event.target.value = "";
        }} />
      <SkillInput ref={skillInput} value={draft} draftKey={key} cwd={project} active={active}
        connected={state.connection === "ready"} disabled={disabled}
        compact={compactCommand(state, () => void controller.compact())}
        placeholder={state.archived ? "恢复对话后即可继续" : "描述任务，或输入 / 选择命令和技能…"}
        onChange={editContent} onPaste={paste} onSend={() => void send()} />
      <div className={styles.composerControls}>
        <ComposerAddMenu cwd={project} active={active} disabled={disabled} anchor={composer}
          onFiles={() => setDialog("files")} onGoal={() => setDialog("goal")}
          onPlugin={(plugin) => addAttachments([plugin])} onSkill={(skill) => skillInput.current?.addSkill(skill)} />
        <AccessPicker value={state.settings.access}
          disabled={false} onChange={(access: AccessMode) => controller.settings({ access })} />
        <div className={styles.modelControls}>
          <UsageStatus active={active} threadId={state.selected} tokenUsage={current?.tokenUsage} />
          <ModelPicker models={state.models} model={state.settings.model} effort={state.settings.effort}
            disabled={false} onChange={controller.settings} />
          <ComposerSubmit state={state} controller={controller}
            hasDraft={hasDraft} reading={reading || workspaceBusy} onSend={send} />
        </div>
      </div>
    </div>
    <div className={styles.composerHint}><span>Enter 发送 · Shift + Enter 换行</span>
      {current && current.tokens > 0 && <span>{formatConversationTokens(current.tokens)} tokens</span>}</div>
    {dialog === "files" && <ComposerFilesDialog onAdd={addAttachments} onImages={() => fileInput.current?.click()}
      onClose={() => setDialog(null)} onError={controller.report} />}
    {dialog === "goal" && <GoalDialog state={state} controller={controller} onClose={() => setDialog(null)} />}
  </div>;
});
