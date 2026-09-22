import { useSyncExternalStore } from "react";
import { mobileConnection } from "../../remoteChat/mobileConnection";
import styles from "./MobileConnectionStatus.module.less";

export function MobileConnectionStatus() {
  const connected = useSyncExternalStore(mobileConnection.subscribe, mobileConnection.getSnapshot);
  return <span className={styles.status} role="status" aria-atomic="true" data-connected={connected}>
    <span className={styles.dot} aria-hidden="true" />
    {connected ? "其他设备已连接" : "暂无设备连接"}
  </span>;
}
