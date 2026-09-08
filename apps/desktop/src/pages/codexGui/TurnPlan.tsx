import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import type { Turn } from "./types";
import { RichText } from "./RichText";
import styles from "./TurnPlan.module.less";

export function TurnPlan({ turn }: { turn: Turn }) {
  if (!turn.plan?.length) return null;
  const completed = turn.plan.filter((step) => step.status === "completed").length;
  return <details className={styles.plan} open={turn.status === "inProgress" ? true : undefined}>
    <summary>任务计划 <span>{completed}/{turn.plan.length}</span></summary>
    {turn.planExplanation && <RichText text={turn.planExplanation} />}
    <ol>{turn.plan.map((step, index) => {
      const Icon = step.status === "completed" ? CheckCircle2 : step.status === "inProgress" ? LoaderCircle : Circle;
      return <li key={index} data-status={step.status}><Icon size={15} /><span>{step.step}</span>
        <small>{step.status === "completed" ? "已完成" : step.status === "inProgress" ? "进行中" : "待开始"}</small></li>;
    })}</ol>
  </details>;
}
