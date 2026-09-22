import { Modal } from "antd";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ChromePluginAction, ChromePluginStatus } from "../../../api/chromePlugin";
import { ManualInstall } from "./ManualInstall";
import styles from "./index.module.less";

interface Props {
  status: ChromePluginStatus;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAction: (action: ChromePluginAction) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}

export function ChromeSetup({ status, busy, error, onClose, onAction, onRefresh }: Props) {
  return <Modal open title="安装并连接 Chrome 浏览器助手" width={448} footer={null} onCancel={onClose}>
    <div className={styles.setup}>
      <p>从 Chrome 应用商店添加浏览器助手，安装后即可连接 Codex Switch。</p>
      <ol>
        <li>打开下方商店页面，点击“添加至 Chrome”并确认安装。</li>
        <li>在 Chrome 工具栏打开“Codex Switch 浏览器助手”，确认显示“已连接”。</li>
        <li>回到 Codex Switch，开启新任务即可使用。</li>
      </ol>
      <div className={styles.setupActions}>
        <button className="primary-button" disabled={busy} onClick={() => void onAction("openStore")}>
          <ExternalLink size={15} />前往 Chrome 应用商店
        </button>
        <button className="refresh-all" disabled={busy} onClick={() => void onRefresh()}>
          <RefreshCw size={15} />检查连接
        </button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.connection} role="status">
        {status.connectedBrowsers > 0 ? `已连接 ${status.connectedBrowsers} 个浏览器` : "等待 Chrome 连接…"}
      </p>
      <p className={styles.hint}>
        默认允许所有网站，也可在浏览器助手中改为逐站确认。商店安装的扩展会自动更新。
      </p>
      <ManualInstall extensionDirectory={status.extensionDirectory} busy={busy} onAction={onAction} />
    </div>
  </Modal>;
}
