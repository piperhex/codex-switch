import { useRef, useState } from "react";
import { Button, Input, Select, Tag, Tooltip } from "antd";
import { ArrowUp, ImagePlus, ShieldCheck, Square, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { GuiController } from "./controller";
import type { AccessMode, GuiState } from "./types";
import { projectName } from "./ThreadSidebar";
import { ModelPicker } from "./ModelPicker";
import { UsageStatus } from "./UsageStatus";
import { ProjectPicker } from "./ProjectPicker";
import styles from "./styles.module.less";

const ACCESS_OPTIONS = [{ value: "read-only", label: "只读" }, { value: "workspace-write", label: "项目内编辑" },
  { value: "danger-full-access", label: "完全访问" }];

export function Composer({ state, controller, active }: {
  state: GuiState; controller: GuiController; active: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, { text: string; images: string[] }>>({});
  const composing = useRef(false);
  const key = state.selected ?? "new";
  const draft = drafts[key] ?? { text: "", images: [] };
  const edit = (patch: Partial<typeof draft>) => setDrafts((values) => ({ ...values, [key]: { ...draft, ...patch } }));
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const project = state.selected
    ? state.projectOverrides[state.selected] ?? current?.thread.cwd ?? "" : state.settings.cwd;
  const running = Boolean(current?.activeTurn);
  const canSend = state.connection === "ready" && !state.sending && !state.archived
    && Boolean(draft.text.trim() || draft.images.length);
  const send = async () => {
    if (!canSend || running) return;
    if (await controller.send(draft.text, draft.images)) {
      setDrafts((values) => ({ ...values, [key]: { text: "", images: [] } }));
    } else {
      const selected = controller.getSnapshot().selected ?? "new";
      setDrafts((values) => ({ ...values, [selected]: draft }));
    }
  };
  const attach = async () => {
    try {
      const paths = await open({ multiple: true, title: "添加图片",
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
      if (paths) {
        edit({ images: [...new Set([...draft.images, ...(Array.isArray(paths) ? paths : [paths])])].slice(0, 8) });
      }
    } catch (error) { controller.report(error); }
  };
  return <div className={styles.composerWrap}>
    <ProjectPicker value={project} projects={state.projects} disabled={running || state.sending || state.archived}
      onChange={controller.setProject} onError={controller.report} />
    <div className={styles.composer}>
      {draft.images.length > 0 && <div className={styles.attachments}>{draft.images.map((path) => <Tag key={path}
        closable closeIcon={<X size={12} />}
        onClose={() => edit({ images: draft.images.filter((entry) => entry !== path) })}>
        {projectName(path)}
      </Tag>)}</div>}
      <Input.TextArea value={draft.text} autoSize={{ minRows: 3, maxRows: 9 }} maxLength={128000}
        placeholder={state.archived ? "恢复对话后即可继续" : "描述任务，或提出问题…"} aria-label="消息"
        disabled={state.connection !== "ready" || state.archived}
        onChange={(event) => edit({ text: event.target.value })}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing) {
            event.preventDefault(); void send();
          }
        }} />
      <div className={styles.composerControls}>
        <Tooltip title="添加图片" styles={{ root: { maxWidth: 400 } }}>
          <Button type="text" icon={<ImagePlus size={18} />} aria-label="添加图片" disabled={draft.images.length >= 8}
            onClick={() => void attach()} />
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
          {running ? <Button type="primary" shape="circle" icon={<Square size={14} fill="currentColor" />}
            aria-label="停止生成" onClick={() => void controller.interrupt()} />
            : <Button type="primary" shape="circle" icon={<ArrowUp size={19} />} aria-label="发送消息"
              loading={state.sending} disabled={!canSend} onClick={() => void send()} />}
        </div>
      </div>
    </div>
    <div className={styles.composerHint}><span>Enter 发送 · Shift + Enter 换行</span>
      {current && current.tokens > 0 && <span>{current.tokens.toLocaleString()} tokens</span>}</div>
  </div>;
}
