import type { ComputerUsePermission, ComputerUsePermissions } from "../../../api/computerUse";
import styles from "./index.module.less";

interface Props {
  permissions: ComputerUsePermissions;
  busy: boolean;
  onRequest: (permission: ComputerUsePermission) => Promise<boolean>;
}

const PERMISSIONS: { key: ComputerUsePermission; label: string }[] = [
  { key: "accessibility", label: "辅助功能" },
  { key: "screenRecording", label: "屏幕录制" },
];

export function Permissions({ permissions, busy, onRequest }: Props) {
  const ready = permissions.accessibility && permissions.screenRecording;
  return <div className={styles.permissions}>
    <p>{ready ? "桌面操作权限已开启" : "请在系统设置中为 Codex Switch 开启以下权限："}</p>
    {PERMISSIONS.map(({ key, label }) => <div className={styles.permission} key={key}>
      <span>{label}</span>
      {permissions[key] ? <span>已开启</span> : <button disabled={busy}
        onClick={() => void onRequest(key)} aria-label={`开启${label}`}>去开启</button>}
    </div>)}
    {!ready && <p>开启后请重新打开对话；若系统提示退出，请重启 Codex Switch。</p>}
  </div>;
}
