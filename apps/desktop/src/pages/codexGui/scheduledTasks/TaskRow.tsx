import { Button, Dropdown } from "antd";
import { CheckCircle2, CirclePlay, LoaderCircle, MoreHorizontal, PauseCircle } from "lucide-react";
import { scheduleLabel, type ScheduledTask } from "./types";
import styles from "./scheduledTasks.module.less";

export type TaskAction = "edit" | "run" | "toggle" | "delete" | "open";

export function TaskRow({ task, busy, onAction }: {
  task: ScheduledTask; busy: boolean; onAction: (action: TaskAction, task: ScheduledTask) => void;
}) {
  const running = task.runStatus !== "idle";
  const Icon = running ? LoaderCircle : task.status === "completed" ? CheckCircle2
    : task.status === "paused" ? PauseCircle : CirclePlay;
  const status = running ? "正在执行" : task.status === "paused" ? "已暂停" : "";
  const items = [
    { key: "edit", label: "编辑任务", disabled: busy || running },
    { key: "run", label: "立即运行", disabled: busy || running },
    ...(task.status === "completed" ? [] : [{ key: "toggle",
      label: task.status === "active" ? "暂停任务" : "开启任务", disabled: busy || running }]),
    { key: "open", label: "查看任务对话", disabled: !task.lastThreadId },
    { key: "delete", label: "删除任务", danger: true, disabled: busy || running },
  ];
  return <div className={`${styles.taskRow} ${task.status === "paused" ? styles.paused : ""}`}>
    <Icon size={20} className={running ? styles.spinning : styles.taskIcon} aria-hidden="true" />
    <button type="button" className={styles.taskContent} disabled={busy}
      onClick={() => onAction(running && task.lastThreadId ? "open" : "edit", task)}>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.taskSchedule}>{scheduleLabel(task.schedule)}{status && ` · ${status}`}</span>
      {task.error && <span className={styles.taskError}>{task.error}</span>}
    </button>
    <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => onAction(key as TaskAction, task) }}
      overlayStyle={{ maxWidth: 400 }}>
      <Button type="text" className={styles.taskMenu} icon={<MoreHorizontal size={19} />}
        aria-label={`管理任务：${task.title}`} />
    </Dropdown>
  </div>;
}
