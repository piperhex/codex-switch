import { Modal } from "antd";
import { FolderOpen, ExternalLink, RefreshCw } from "lucide-react";
import type { ChromePluginAction, ChromePluginStatus } from "../../../api/chromePlugin";
import styles from "./index.module.less";

interface Props {
  status: ChromePluginStatus;
  busy: boolean;
  onClose: () => void;
  onAction: (action: ChromePluginAction) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}

export function ChromeSetup({ status, busy, onClose, onAction, onRefresh }: Props) {
  return <Modal open title="连接 Chrome 浏览器助手" width={480} footer={null} onCancel={onClose}>
    <div className={styles.setup}>
      <p>首次使用时，需要在 Chrome 中添加扩展。无需安装 ChatGPT。</p>
      <ol>
        <li>打开 Chrome 扩展管理页，开启右上角的“开发者模式”。</li>
        <li>选择“加载已解压的扩展程序”，再选择下面的扩展目录。</li>
        <li>在 Chrome 工具栏打开“Codex Switch 浏览器助手”，确认显示“已连接”。</li>
      </ol>
      <div className={styles.path}>{status.extensionDirectory}</div>
      <div className={styles.setupActions}>
        <button className="primary-button" disabled={busy} onClick={() => void onAction("openExtensions")}>
          <ExternalLink size={15} />打开 Chrome 扩展页
        </button>
        <button className="refresh-all" disabled={busy} onClick={() => void onAction("openFolder")}>
          <FolderOpen size={15} />打开扩展目录
        </button>
      </div>
      <p className={styles.connection} role="status">
        {status.connectedBrowsers > 0 ? `已连接 ${status.connectedBrowsers} 个浏览器` : "等待 Chrome 连接…"}
      </p>
      <button className="refresh-all" disabled={busy} onClick={() => void onRefresh()}>
        <RefreshCw size={15} />检查连接
      </button>
      <p className={styles.hint}>
        在 Chrome 中允许网站访问后，开启新任务即可使用。默认允许所有网站，也可在浏览器助手中改为逐站确认。
      </p>
    </div>
  </Modal>;
}
