import type { TaskInput } from "./types";

export const TASK_SUGGESTIONS: (TaskInput & { description: string; icon: "briefing" | "review" | "monitor" })[] = [
  { title: "每日简报", description: "以日历、未读电子邮件和优先事项摘要开启每个工作日", icon: "briefing",
    prompt: "根据可用的日历、未读邮件和最近工作，整理今天的简报，列出重要安排和优先事项。信息不足时请明确说明。",
    cwd: "", schedule: { kind: "weekdays", time: "08:00" } },
  { title: "每周回顾", description: "每周五将你最近的工作整理成简明的状态更新", icon: "review",
    prompt: "回顾本周的工作，整理完成事项、当前进展、遇到的问题和下周重点，生成一份简洁的状态更新。",
    cwd: "", schedule: { kind: "weekly", time: "16:00", weekday: 4 } },
  { title: "跟进监控", description: "查看最近的电子邮件和日历活动，并标记需要你关注的事项", icon: "monitor",
    prompt: "查看可用的最近邮件和日历活动，找出尚未回复、即将到期或需要跟进的事项，按优先级列出。",
    cwd: "", schedule: { kind: "weekdays", time: "09:00" } },
];
