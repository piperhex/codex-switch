import type { Item } from "./types";
import { RichText } from "./RichText";
import { MessageImage } from "./MessageImage";
import { MessageLink } from "./MessageLink";
import { CopyButton } from "./CopyButton";
import { formatTurnDuration } from "./turnTiming";
import styles from "./ActivityRow.module.less";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function serialized(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }

function generatedImage(item: Item) {
  if (item.imageUrl) return item.imageUrl;
  if (typeof item.result !== "string" || !item.result) return undefined;
  return /^(https?:|data:)/i.test(item.result) ? item.result : `data:image/png;base64,${item.result}`;
}

function OutputPart({ value }: { value: unknown }) {
  const part = record(value);
  if (typeof part?.text === "string") return <RichText text={part.text} />;
  if (part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
    return <MessageImage src={`data:${part.mimeType};base64,${part.data}`} alt="工具返回的图片" />;
  }
  if (part?.type === "inputImage" && typeof part.imageUrl === "string") {
    return <MessageImage src={part.imageUrl} alt="工具返回的图片" />;
  }
  if (part?.type === "inputAudio" && typeof part.audioUrl === "string"
    && /^(https?:\/\/|data:audio\/(?:mp3|mpeg|wav|ogg);base64,)/i.test(part.audioUrl)) {
    return <audio controls preload="none" src={part.audioUrl} aria-label="工具返回的音频" />;
  }
  if ((part?.type === "resource_link" || part?.type === "resource") && typeof part.uri === "string") {
    return <MessageLink href={part.uri}>{typeof part.name === "string" ? part.name : part.uri}</MessageLink>;
  }
  return <pre>{serialized(value)}</pre>;
}

function ToolResult({ item }: { item: Item }) {
  const result = record(item.result);
  const content = item.contentItems ?? (Array.isArray(result?.content) ? result.content : undefined);
  const structured = result?.structuredContent;
  return <>
    {item.arguments != null && <details className={styles.payload}><summary>输入</summary>
      <pre>{serialized(item.arguments)}</pre><CopyButton text={serialized(item.arguments) ?? ""} label="复制工具输入" />
    </details>}
    {item.progress?.map((text, index) => <p key={index}>{text}</p>)}
    {content?.map((part, index) => <OutputPart key={index} value={part} />)}
    {structured != null && <details className={styles.payload}><summary>结构化结果</summary>
      <pre>{serialized(structured)}</pre></details>}
    {!content && item.result != null && <OutputPart value={item.result} />}
    {item.output != null && <OutputPart value={item.output} />}
    {item.error != null && <div className={styles.failure} role="status">
      {typeof record(item.error)?.message === "string" ? String(record(item.error)?.message) : "工具执行失败，请重试。"}
    </div>}
    {item.result == null && item.output == null && !content && !item.error && <p className={styles.emptyBody}>
      {item.status === "inProgress" ? "正在等待工具返回…" : "工具没有返回文本内容。"}</p>}
  </>;
}

export function ToolDetails({ item, text }: { item: Item; text: string }) {
  if (["reasoning", "plan", "enteredReviewMode", "exitedReviewMode"].includes(item.type)) {
    return <RichText text={text} />;
  }
  if (item.type === "sleep") return <p>等待时长：{formatTurnDuration(item.durationMs ?? 0)}</p>;
  if (item.type === "contextCompaction") return <p>较早的对话已整理为摘要，可以继续处理当前任务。</p>;
  if (item.type === "commandExecution") return <>
    <div className={styles.commandToolbar}><span>{item.cwd}</span>
      {item.durationMs != null && <span>{formatTurnDuration(item.durationMs)}</span>}
      <CopyButton text={item.command ?? ""} label="复制命令" /></div>
    <pre className={styles.commandCode}>{item.command}</pre>
    <pre className={styles.output}>{item.aggregatedOutput || (item.status === "inProgress" ? "等待输出…" : "没有文本输出")}</pre>
    <div className={styles.commandToolbar}>
      {item.exitCode != null && <span>退出码：{item.exitCode}</span>}
      <CopyButton text={item.aggregatedOutput ?? ""} label="复制输出" /></div>
  </>;
  if (["mcpToolCall", "dynamicToolCall", "functionCallOutput"].includes(item.type)) return <ToolResult item={item} />;
  if (item.type === "webSearch") return <>
    {(item.action?.queries ?? [item.action?.query || item.query]).filter(Boolean).map((query, index) =>
      <p key={index}>{query}</p>)}
    {item.action?.url && <MessageLink href={item.action.url}>{item.action.url}</MessageLink>}
    {item.action?.pattern && <p>查找：{item.action.pattern}</p>}
    {item.results?.map((result, index) => <div key={index} className={styles.searchResult}>
      <MessageLink href={result.url}>{result.title || result.url}</MessageLink>
      {result.snippet && <p>{result.snippet}</p>}</div>)}
  </>;
  if (item.type === "imageView" || item.type === "imageGeneration") return <>
    <MessageImage src={generatedImage(item)} alt={item.path || "生成的图片"} />
    {(item.path || item.savedPath) && <MessageLink href={item.path || item.savedPath}>
      {item.path || item.savedPath}</MessageLink>}
    {item.failure?.message && <p className={styles.failure}>{item.failure.message}</p>}
    {item.revisedPrompt && <RichText text={item.revisedPrompt} />}
  </>;
  if (item.type === "collabAgentToolCall" || item.type === "collabToolCall") return <>
    {item.prompt && <RichText text={item.prompt} />}
    {Object.entries(item.agentsStates ?? {}).map(([id, state]) => <div key={id}>
      <p>{state.status === "completed" ? "任务已完成" : "协作任务"} · {id}</p>
      {state.message && <RichText text={state.message} />}</div>)}
    {item.agentStatus != null && <pre>{serialized(item.agentStatus)}</pre>}
  </>;
  return <pre>{text}</pre>;
}
