import { Fragment, memo, useEffect, useRef } from "react";
import { Spin } from "antd";
import { Terminal } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Conversation, Item } from "./types";
import { ActivityRow } from "./ActivityRow";
import { TurnDuration } from "./TurnDuration";
import { MessageImage } from "./MessageImage";
import { CopyButton } from "./CopyButton";
import { UserMessage } from "./UserMessage";
import { useStreamingText } from "./useStreamingText";
import styles from "./styles.module.less";

const TOOL_LABELS: Record<string, string> = { fileChange: "文件修改",
  mcpToolCall: "调用工具", dynamicToolCall: "调用工具", collabAgentToolCall: "协作任务", webSearch: "搜索网页",
  contextCompaction: "已整理对话上下文", imageView: "查看图片", imageGeneration: "生成图片", plan: "计划" };
const FOLLOW_SCROLL_DISTANCE = 100;

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => <a href={href} onClick={(event) => {
    event.preventDefault();
    if (href && /^https?:\/\//i.test(href)) void openUrl(href);
  }}>{children}</a>,
  img: ({ src, alt, title }) => <MessageImage key={src} src={src} alt={alt} title={title} />,
  pre: ({ children }) => <pre>{children}</pre>,
};
const REMARK_PLUGINS = [remarkGfm];

const RichText = memo(function RichText({ text }: { text: string }) {
  return <div className={styles.markdown}>
    <Markdown remarkPlugins={REMARK_PLUGINS} skipHtml components={MARKDOWN_COMPONENTS}>{text}</Markdown>
  </div>;
});

function AgentMessage({ text, streaming }: { text: string; streaming: boolean }) {
  const visible = useStreamingText(text, streaming);
  return <article className={styles.agentMessage}>
    <div className={styles.agentLabel}><Terminal size={15} /> Codex</div>
    <RichText text={visible} /><CopyButton text={text} />
  </article>;
}

function toolText(item: Item) {
  if (item.type === "reasoning") {
    return [...(item.summary ?? []), ...((item.content as string[] | undefined) ?? [])].join("\n\n");
  }
  if (item.type === "commandExecution") return [item.command, item.aggregatedOutput,
    item.exitCode != null ? `退出码：${item.exitCode}` : ""].filter(Boolean).join("\n");
  if (item.type === "fileChange") {
    return item.changes?.map((change) => `${change.path}\n${change.diff}`).join("\n\n") ?? "";
  }
  return item.text ?? item.query ?? JSON.stringify(item.result ?? item.arguments ?? {}, null, 2);
}

const Message = memo(function Message({ item, streaming, startedAt }: {
  item: Item; streaming: boolean; startedAt?: number | null;
}) {
  if (item.type === "userMessage") return <UserMessage item={item} startedAt={startedAt} />;
  if (item.type === "agentMessage") return <AgentMessage text={item.text ?? ""} streaming={streaming} />;
  const text = toolText(item);
  if (item.type === "reasoning" && !text.trim()) return null;
  if (item.type === "reasoning" || item.type === "commandExecution") return <ActivityRow item={item} text={text} />;
  return <details className={styles.toolMessage}>
    <summary><span>{TOOL_LABELS[item.type] ?? "任务活动"}{item.tool ? ` · ${item.tool}` : ""}</span>
      <span className={styles.muted}>{item.status === "inProgress" ? "进行中" : "查看详情"}</span></summary>
    <pre>{text}</pre>
  </details>;
});

export function Messages({ value, selected, active = true }: {
  value?: Conversation; selected: string | null; active?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    follow.current = true;
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [selected]);
  useEffect(() => {
    if (!content.current) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={viewport} className={styles.messageViewport} onScroll={() => {
    const node = viewport.current;
    if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_SCROLL_DISTANCE;
  }}>
    <div ref={content} className={styles.messageContent}>
      {!selected && <div className={styles.welcome}>
        <div className={styles.welcomeIcon}><Terminal size={28} /></div>
        <h1>想一起完成什么？</h1><p>直接提问，或选择一个项目开始任务。</p>
        <div className={styles.suggestions}><span>理解代码</span><span>实现功能</span><span>排查问题</span></div>
      </div>}
      {selected && !value && <div className={styles.listEmpty}><Spin /><p>正在读取对话…</p></div>}
      {value?.turns.map((turn) => {
        const responseIndex = turn.items.findIndex((item) => item.type !== "userMessage");
        return <div key={turn.id} className={styles.turn}>
        {turn.items.map((item, index) => <Fragment key={item.id}>
          {index === responseIndex &&
            <TurnDuration turn={turn} running={value.activeTurn === turn.id} active={active} />}
          <Message item={item} startedAt={turn.startedAt} streaming={value.activeTurn === turn.id} />
        </Fragment>)}
        {responseIndex === -1 &&
          <TurnDuration turn={turn} running={value.activeTurn === turn.id} active={active} />}
        {turn.status === "interrupted" && <p className={styles.muted}>已停止生成</p>}
        {turn.status === "failed" && <p className={styles.turnError}>本次回复未完成，可以继续发送消息重试。</p>}
      </div>;
      })}
      {value?.plan.length ? <details className={styles.toolMessage}><summary>任务计划</summary>
        <ul>{value.plan.map((step, index) =>
          <li key={index}>{step.status === "completed" ? "✓ " : "○ "}{step.step}</li>)}</ul>
      </details> : null}
      {value?.diff && <details className={styles.toolMessage}>
        <summary>查看本次修改</summary><pre>{value.diff}</pre></details>}
      {value?.error && <p className={styles.turnError} role="status">{value.error}</p>}
      {value?.activeTurn && <div className={styles.working} role="status">
        <span className={styles.runningDot} />Codex 正在处理…</div>}
    </div>
  </div>;
}
