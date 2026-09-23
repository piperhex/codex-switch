import { useState, useSyncExternalStore } from "react";
import { Popover } from "antd";
import { mobileConnection } from "../../remoteChat/mobileConnection";
import { connectionDetails } from "../../remoteChat/connectionDetails";
import { formatRelayBytes } from "../../../../../shared/remote-chat/relayUsage";
import styles from "./MobileConnectionStatus.module.less";

export function MobileConnectionStatus() {
  const [open, setOpen] = useState(false);
  const connected = useSyncExternalStore(mobileConnection.subscribe, mobileConnection.getSnapshot);
  const details = useSyncExternalStore(connectionDetails.subscribe, connectionDetails.getSnapshot);
  const active = details.devices.filter((device) => device.mode !== 'offline');
  const content = <div className={styles.details}>
    <strong>设备连接</strong>
    {!active.length && <p className={styles.muted}>暂无设备连接到这台电脑。</p>}
    <div className={styles.devices}>{active.map((device) => <section key={device.id} className={styles.device}>
      <div className={styles.heading}><strong>{device.name}</strong>
        <span className={styles.mode} data-mode={device.mode}>
          {device.mode === 'direct' ? 'P2P 直连' : device.mode === 'relay' ? 'Relay 转发' : '连接中'}
        </span>
      </div>
      <div className={styles.muted}>{device.platform || '设备'} · {device.id.slice(0, 8)} ·
        {' '}{new Date(device.connectedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 接入</div>
      <div>本次转发：{device.uploadBytes === undefined || device.downloadBytes === undefined ? '等待统计'
        : formatRelayBytes(device.uploadBytes + device.downloadBytes)}</div>
      {device.uploadBytes !== undefined && device.downloadBytes !== undefined && <div className={styles.muted}>
        发送 {formatRelayBytes(device.uploadBytes)} · 接收 {formatRelayBytes(device.downloadBytes)}
      </div>}
    </section>)}</div>
    {details.usage && <section className={styles.allowance}>
      <strong>账号本月转发流量</strong>
      <div>{formatRelayBytes(details.usage.monthUsedBytes)} / {details.usage.monthlyLimitBytes === -1
        ? '不限量' : formatRelayBytes(details.usage.monthlyLimitBytes)}</div>
      <p className={styles.muted}>每月 1 日（北京时间）重置额度，所有设备共用。</p>
    </section>}
    {details.blocked && <p className={styles.warning}>服务器转发暂不可用，可使用 P2P 直连或联系管理员。</p>}
    <p className={styles.muted}>仅统计服务器转发。P2P 直连不计流量，连接保活产生的转发流量仍会计入。</p>
  </div>;
  return <Popover trigger="click" placement="bottomRight" arrow={false} content={content}
    open={open} onOpenChange={setOpen} styles={{ body: { maxWidth: 400 } }}>
    <button type="button" className={styles.status} aria-label="查看设备连接详情"
      aria-expanded={open} data-connected={connected}>
    <span className={styles.dot} aria-hidden="true" />
    {connected ? "其他设备已连接" : "暂无设备连接"}
    </button>
  </Popover>;
}
