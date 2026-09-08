import { useRef } from "react";
import { Button, Select, Tooltip } from "antd";
import { ImagePlus, ShieldCheck } from "lucide-react";
import { ComposerSubmit } from "./ComposerSubmit";
import type { GuiController } from "./controller";
import type { AccessMode, GuiState } from "./types";
import { ImageAttachments } from "./ImageAttachments";
import { IMAGE_TYPES, MAX_IMAGES, useComposerDraft } from "./useComposerDraft";
import { ModelPicker } from "./ModelPicker";
import { UsageStatus } from "./UsageStatus";
import { ProjectPicker } from "./ProjectPicker";
import { SkillInput } from "./SkillInput";
import styles from "./styles.module.less";

const ACCESS_OPTIONS = [{ value: "read-only", label: "只读" }, { value: "workspace-write", label: "项目内编辑" },
  { value: "danger-full-access", label: "完全访问" }];

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
  const disabled = state.connection !== "ready" || state.sending || state.archived;
  const canSend = !disabled && !reading
    && Boolean(draft.text.trim() || draft.images.length);
  const send = async () => {
    if (!canSend || running) return;
    await sendDraft();
  };
  return <div className={styles.composerWrap}>
    <ProjectPicker value={project} projects={state.projects} disabled={running || state.sending || state.archived}
      onChange={controller.setProject} onError={controller.report} />
    <div className={styles.composer}>
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
        <ShieldCheck size={15} />
        <Select size="small" variant="borderless" aria-label="访问权限"
          value={state.settings.access} options={ACCESS_OPTIONS.map((option) =>
            option.value === "workspace-write" && !project ? { ...option, label: "允许编辑" } : option)}
          disabled={running || state.sending} onChange={(access: AccessMode) => controller.settings({ access })} />
        <div className={styles.modelControls}>
          <UsageStatus active={active} />
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
