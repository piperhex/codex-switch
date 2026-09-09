import { useRef } from "react";
import { Button, Tooltip } from "antd";
import { ImagePlus } from "lucide-react";
import { AccessPicker } from "./AccessPicker";
import { ComposerSubmit } from "./ComposerSubmit";
import type { GuiController } from "./controller";
import type { AccessMode, GuiState } from "./types";
import { ImageAttachments } from "./ImageAttachments";
import { IMAGE_TYPES, MAX_IMAGES, useComposerDraft } from "./useComposerDraft";
import { ModelPicker } from "./ModelPicker";
import { UsageStatus } from "./UsageStatus";
import { ProjectPicker } from "./ProjectPicker";
import { SkillInput } from "./SkillInput";
import { QueuedMessages } from "./QueuedMessages";
import styles from "./styles.module.less";

export function Composer({ state, controller, active }: {
  state: GuiState; controller: GuiController; active: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const key = state.selected ?? "new";
  const { draft, reading, editContent, removeImage, addImages, paste, send: sendDraft } = useComposerDraft(key, controller);
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const project = state.selected
    ? state.projectOverrides[state.selected] ?? current?.thread.cwd ?? "" : state.settings.cwd;
  const running = Boolean(current?.activeTurn);
  const queuedMessages = state.selected ? state.queued[state.selected] ?? [] : [];
  const attachedQueue = running && queuedMessages.length > 0;
  const disabled = state.connection !== "ready" || state.sending || state.archived;
  const canSend = !disabled && !reading
    && Boolean(draft.text.trim() || draft.images.length);
  const send = async () => {
    if (!canSend) return;
    await sendDraft();
  };
  return <div className={styles.composerWrap}>
    {state.selected && <QueuedMessages threadId={state.selected} messages={queuedMessages}
      running={running} connected={state.connection === "ready"} queue={controller.queue} />}
    {!running && <ProjectPicker value={project} projects={state.projects} disabled={state.sending || state.archived}
      onChange={controller.setProject} onError={controller.report} />}
    <div className={`${styles.composer} ${attachedQueue ? styles.composerAttached : ""}`}>
      <ImageAttachments images={draft.images} disabled={state.sending} onRemove={removeImage} />
      <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden disabled={disabled}
        aria-label="选择图片" onChange={(event) => {
          addImages(Array.from(event.target.files ?? [])); event.target.value = "";
        }} />
      <SkillInput value={draft} draftKey={key} cwd={project} active={active}
        connected={state.connection === "ready"} disabled={disabled}
        placeholder={state.archived ? "恢复对话后即可继续" : "描述任务，或输入 / 选择 Skill…"}
        onChange={editContent} onPaste={paste} onSend={() => void send()} />
      <div className={styles.composerControls}>
        <Tooltip title="添加图片" styles={{ root: { maxWidth: 400 } }}>
          <Button type="text" icon={<ImagePlus size={18} />} aria-label="添加图片"
            disabled={disabled || draft.images.length >= MAX_IMAGES} onClick={() => fileInput.current?.click()} />
        </Tooltip>
        <AccessPicker value={state.settings.access}
          disabled={running || state.sending} onChange={(access: AccessMode) => controller.settings({ access })} />
        <div className={styles.modelControls}>
          <UsageStatus active={active} threadId={state.selected} tokenUsage={current?.tokenUsage} />
          <ModelPicker models={state.models} model={state.settings.model} effort={state.settings.effort}
            disabled={running || state.sending} onChange={controller.settings} />
          <ComposerSubmit state={state} controller={controller}
            hasDraft={Boolean(draft.text.trim() || draft.images.length)} reading={reading} onSend={send} />
        </div>
      </div>
    </div>
    <div className={styles.composerHint}><span>Enter 发送 · Shift + Enter 换行</span>
      {current && current.tokens > 0 && <span>{current.tokens.toLocaleString()} tokens</span>}</div>
  </div>;
}
