import { useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode, UIEvent } from "react";
import { Modal } from "antd";
import { AlertCircle, CheckCircle2, FileCode2, LoaderCircle } from "lucide-react";
import { useTomlEditor, type TomlEditorProps } from "./useTomlEditor";
import styles from "./editorStyles.module.less";

const INDENTATION = "  ";
const TOKEN_PATTERN = [
  '"""[\\s\\S]*?(?:"""|$)', "'''[\\s\\S]*?(?:'''|$)",
  '"(?:\\\\[\\s\\S]|[^"\\\\])*"', "'[^']*'", "#[^\\n]*",
  "^[ \\t]*\\[\\[?[^\\n]*\\]\\]?", "^[ \\t]*[A-Za-z0-9_.-]+(?=[ \\t]*=)",
  "\\b(?:true|false|inf|nan)\\b", "\\b\\d[\\dA-Za-z_.:+-]*\\b",
].join("|");

function tokenClass(token: string) {
  const first = token.trimStart()[0];
  if (first === "#") return styles.comment;
  if (first === '"' || first === "'") return styles.string;
  if (first === "[") return styles.section;
  if (/^(true|false|inf|nan)$/.test(token)) return styles.literal;
  if (/^\d/.test(token)) return styles.number;
  return styles.key;
}

function highlightedToml(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(TOKEN_PATTERN, "gm");
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(content.slice(cursor, start));
    nodes.push(<span key={start} className={tokenClass(match[0])}>{match[0]}</span>);
    cursor = start + match[0].length;
  }
  nodes.push(content.slice(cursor), "\n");
  return nodes;
}

function useEditorScroll() {
  const highlight = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  function synchronize(event: UIEvent<HTMLTextAreaElement>) {
    if (highlight.current) {
      highlight.current.scrollTop = event.currentTarget.scrollTop;
      highlight.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (gutter.current) gutter.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
  }
  return { highlight, gutter, synchronize };
}

export function TomlEditorModal(props: TomlEditorProps) {
  const editor = useTomlEditor(props);
  const scroll = useEditorScroll();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const zh = props.language !== "en";
  const tokens = useMemo(() => highlightedToml(editor.draft), [editor.draft]);
  const lines = useMemo(() => editor.draft.split("\n").length, [editor.draft]);
  const busy = editor.status === "checking" || editor.status === "saving";
  const statusLabels = zh
    ? { clean: "已同步", changed: "离开编辑区后自动保存", checking: "正在校验…",
      saving: "正在保存…", saved: "已保存", error: "尚未保存" }
    : { clean: "Up to date", changed: "Saves when you leave the editor", checking: "Checking…",
      saving: "Saving…", saved: "Saved", error: "Not saved" };

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.shiftKey) return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    editor.edit(value.slice(0, selectionStart) + INDENTATION + value.slice(selectionEnd));
    requestAnimationFrame(() => textarea.current?.setSelectionRange(
      selectionStart + INDENTATION.length, selectionStart + INDENTATION.length,
    ));
  }

  async function close() {
    if (!await editor.close()) textarea.current?.focus();
  }

  return <Modal open={props.open} centered width="min(1000px, calc(100vw - 40px))"
    className={styles.modal} footer={null} maskClosable={false} onCancel={() => void close()}
    title={<span className={styles.title}><FileCode2 size={19} />config.toml</span>}>
    <p className={styles.hint}>{zh
      ? "离开编辑区或关闭窗口时自动保存。格式有误时会保留修改，修正后再保存。"
      : "Changes save when you leave the editor or close this window. Fix any errors before saving."}</p>
    <div className={`${styles.frame}${editor.issue ? ` ${styles.invalid}` : ""}`}>
      <div className={styles.gutter} aria-hidden="true"><div ref={scroll.gutter}>
        {Array.from({ length: lines }, (_, index) => <div key={index}
          className={editor.issue?.line === index + 1 ? styles.errorLine : undefined}>{index + 1}</div>)}
      </div></div>
      <div className={styles.codeArea}>
        <pre className={styles.highlight} aria-hidden="true" ref={scroll.highlight}>{tokens}</pre>
        <textarea ref={textarea} className={styles.input} autoFocus
          aria-label={zh ? "配置文件内容" : "Configuration content"}
          aria-invalid={Boolean(editor.issue)} aria-describedby={editor.issue ? "codex-toml-error" : undefined}
          value={editor.draft} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off"
          onChange={(event) => editor.edit(event.target.value)} onKeyDown={handleKeyDown}
          onScroll={scroll.synchronize} onBlur={() => void editor.save()} />
      </div>
    </div>
    <div className={styles.footer}>
      <span className={editor.issue ? styles.errorStatus : styles.status} role="status">
        {busy && <LoaderCircle size={14} className="spin" />}
        {!busy && (editor.issue ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />)}
        {statusLabels[editor.status]}
      </span>
      <span className={styles.shortcut}>
        TOML · {zh ? "Tab 缩进 · Shift+Tab 离开" : "Tab to indent · Shift+Tab to leave"}
      </span>
      <button type="button" className={styles.discard} disabled={editor.saving}
        onMouseDown={(event) => event.preventDefault()} onClick={editor.discard}>
        {zh ? "放弃修改并关闭" : "Discard changes and close"}
      </button>
    </div>
    {editor.issue && <div id="codex-toml-error" className={styles.error} role="alert">
      <AlertCircle size={16} />
      <div><strong>{editor.issue.line ? (zh
        ? `第 ${editor.issue.line} 行${editor.issue.column ? `，第 ${editor.issue.column} 列` : ""}`
        : `Line ${editor.issue.line}${editor.issue.column ? `, column ${editor.issue.column}` : ""}`)
        : (zh ? "请检查配置" : "Check the configuration")}</strong>
      <p>{editor.issue.message}</p></div>
    </div>}
  </Modal>;
}
