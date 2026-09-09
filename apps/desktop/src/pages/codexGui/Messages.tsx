import type { ReactNode } from "react";
import { Spin } from "antd";
import { ArrowDown, Terminal } from "lucide-react";
import type { Conversation } from "./types";
import { TurnMessage } from "./TurnMessage";
import { useFollowScroll } from "./useFollowScroll";
import styles from "./styles.module.less";

export function Messages({ value, selected, active = true, footer }: {
  value?: Conversation; selected: string | null; active?: boolean; footer?: ReactNode;
}) {
  const { viewport, content, away, onScroll, jumpToLatest } = useFollowScroll(selected);
  return <div className={styles.messageArea}>
    <div ref={viewport} className={styles.messageViewport} onScroll={onScroll}>
      <div ref={content} className={styles.messageScrollBody}>
        <div className={styles.messageContent}>
          {!selected && <div className={styles.welcome}>
            <div className={styles.welcomeIcon}><Terminal size={28} /></div>
            <h1>想一起完成什么？</h1><p>直接提问，或选择一个项目开始任务。</p>
            <div className={styles.suggestions}><span>理解代码</span><span>实现功能</span><span>排查问题</span></div>
          </div>}
          {selected && !value && <div className={styles.listEmpty}><Spin /><p>正在读取对话…</p></div>}
          {value?.turns.map((turn) => <TurnMessage key={turn.id} turn={turn}
            running={value.activeTurn === turn.id} active={active} />)}
          {value?.error && <p className={styles.turnError} role="status">{value.error}</p>}
          {value?.activeTurn && <div className={styles.working} role="status">
            <span className={styles.runningDot} />Codex 正在处理…</div>}
        </div>
        <div className={styles.messageFooter}>
          {away && <button type="button" className={styles.jumpToLatest} onClick={jumpToLatest}>
            <ArrowDown size={15} />回到最新消息</button>}
          {footer}
        </div>
      </div>
    </div>
  </div>;
}
