import { useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Select } from "antd";
import type { Schedule, TaskInput } from "./types";
import { WEEKDAYS } from "./types";
import styles from "./scheduledTasks.module.less";

const MAX_PROMPT_LENGTH = 20_000;
const DEFAULT_DELAY_MS = 60 * 60 * 1000;
const FREQUENCIES = [
  { value: "once", label: "仅一次" }, { value: "interval", label: "按间隔重复" },
  { value: "daily", label: "每天" }, { value: "weekdays", label: "每个工作日" },
  { value: "weekly", label: "每周" },
];

function localDateInput(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function initialSchedule(kind: Schedule["kind"]): Schedule {
  if (kind === "once") return { kind, at: Date.now() + DEFAULT_DELAY_MS };
  if (kind === "interval") return { kind, minutes: 5 };
  if (kind === "weekly") return { kind, time: "09:00", weekday: 0 };
  return { kind, time: "09:00" };
}

function ScheduleFields({ value, onChange, disabled }: {
  value: Schedule; onChange: (schedule: Schedule) => void; disabled: boolean;
}) {
  return <div className={styles.scheduleFields}>
    <Select aria-label="重复方式" value={value.kind} options={FREQUENCIES} disabled={disabled}
      onChange={(kind: Schedule["kind"]) => onChange(initialSchedule(kind))} />
    {value.kind === "once" && <Input type="datetime-local" aria-label="执行时间" disabled={disabled}
      value={Number.isFinite(value.at) ? localDateInput(value.at) : ""}
      onChange={(event) => onChange({ ...value, at: new Date(event.target.value).getTime() })} />}
    {value.kind === "interval" && <div className={styles.interval}>
      <span>每</span><InputNumber aria-label="间隔分钟" min={1} max={525_600} precision={0}
        value={value.minutes} disabled={disabled}
        onChange={(minutes) => onChange({ ...value, minutes: minutes ?? 1 })} /><span>分钟</span>
    </div>}
    {value.kind === "weekly" && <Select aria-label="星期" value={value.weekday} disabled={disabled}
      options={WEEKDAYS.map((label, index) => ({ label, value: index }))}
      onChange={(weekday) => onChange({ ...value, weekday })} />}
    {"time" in value && <Input type="time" aria-label="执行时间" value={value.time} disabled={disabled}
      onChange={(event) => onChange({ ...value, time: event.target.value })} />}
  </div>;
}

export function TaskEditor({ initial, editing, busy, error, onClose, onSave }: {
  initial: TaskInput; editing: boolean; busy: boolean; error: string;
  onClose: () => void; onSave: (input: TaskInput) => Promise<boolean>;
}) {
  const [input, setInput] = useState(initial);
  const scheduleValid = input.schedule.kind === "once"
    ? input.schedule.at > Date.now() : !("time" in input.schedule) || Boolean(input.schedule.time);
  const valid = Boolean(input.title.trim() && input.prompt.trim() && scheduleValid);
  const save = async () => { if (valid && !busy && await onSave(input)) onClose(); };
  return <Modal open centered width={400} title={editing ? "编辑定时任务" : "创建定时任务"}
    className={styles.editor} onCancel={onClose} maskClosable={!busy} closable={!busy} keyboard={!busy}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button>
      <Button className={styles.create} type="primary" disabled={!valid} loading={busy}
        onClick={() => void save()}>{editing ? "保存" : "创建任务"}</Button></>}>
    <label className={styles.field}>任务名称<Input autoFocus value={input.title} maxLength={120}
      placeholder="例如：跟进新版本发布" disabled={busy}
      onChange={(event) => setInput({ ...input, title: event.target.value })} /></label>
    <label className={styles.field}>任务内容<Input.TextArea value={input.prompt} maxLength={MAX_PROMPT_LENGTH}
      autoSize={{ minRows: 3, maxRows: 7 }} placeholder="告诉 Codex 需要做什么" disabled={busy}
      onChange={(event) => setInput({ ...input, prompt: event.target.value })} /></label>
    <div className={styles.field}><span>执行安排</span><ScheduleFields value={input.schedule} disabled={busy}
      onChange={(schedule) => setInput({ ...input, schedule })} /></div>
    <label className={styles.field}>项目文件夹（选填）<Input value={input.cwd} disabled={busy}
      placeholder="不填写也可以创建任务"
      onChange={(event) => setInput({ ...input, cwd: event.target.value })} /></label>
    <p className={styles.hint}>任务会在 Codex Switch 运行时执行，时间以运行应用的电脑为准。
      如需你的确认，请打开任务对话。</p>
    {error && <Alert type="error" message={error} />}
  </Modal>;
}
