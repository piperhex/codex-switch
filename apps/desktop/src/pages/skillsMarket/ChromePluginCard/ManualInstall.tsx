import { useState } from "react";
import { Check, Copy, ExternalLink, FolderOpen } from "lucide-react";
import type { ChromePluginAction } from "../../../api/chromePlugin";
import styles from "./index.module.less";

interface Props {
  extensionDirectory: string;
  busy: boolean;
  onAction: (action: ChromePluginAction) => Promise<boolean>;
}

function ExtensionDirectory({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copy = async () => {
    setCopied(false);
    setError("");
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      setError("复制失败，请手动选择并复制路径。");
    }
  };
  return <>
    <button type="button" className={styles.path} aria-label="复制扩展目录路径" onClick={() => void copy()}>
      <span className={styles.pathText}>{path}</span>
      <span className={styles.copyLabel} role="status">
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? "已复制" : "点击复制"}
      </span>
    </button>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </>;
}

export function ManualInstall({ extensionDirectory, busy, onAction }: Props) {
  const [addressCopied, setAddressCopied] = useState(false);
  const openChrome = async () => {
    setAddressCopied(false);
    setAddressCopied(await onAction("openExtensions"));
  };
  return <details className={styles.manualInstall}>
    <summary>手动安装（可选）</summary>
    <p className={styles.hint}>无法使用商店时，可加载本机扩展。已从商店安装的用户无需重复安装。</p>
    <ol>
      <li>打开 Chrome 扩展管理页，开启右上角的“开发者模式”。</li>
      <li>选择“加载已解压的扩展程序”，粘贴下方路径并选择该目录。</li>
    </ol>
    <ExtensionDirectory path={extensionDirectory} />
    <div className={styles.setupActions}>
      <button className="refresh-all" disabled={busy} onClick={() => void openChrome()}>
        <ExternalLink size={15} />打开 Chrome 并复制地址
      </button>
      <button className="refresh-all" disabled={busy} onClick={() => void onAction("openFolder")}>
        <FolderOpen size={15} />打开扩展目录
      </button>
    </div>
    {addressCopied && <p className={`${styles.hint} ${styles.feedback}`} role="status">
      已复制地址，请在 Chrome 地址栏粘贴并回车。
    </p>}
    <p className={styles.hint}>也可在 Chrome 地址栏输入 <code>chrome://extensions/</code> 并回车。</p>
  </details>;
}
