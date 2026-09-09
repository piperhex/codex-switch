export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export const GOAL_STATUS: Record<ThreadGoal["status"], string> = {
  active: "进行中", paused: "已暂停", blocked: "需要协助", usageLimited: "用量已达上限",
  budgetLimited: "预算已用完", complete: "已完成",
};
