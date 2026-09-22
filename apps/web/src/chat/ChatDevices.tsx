import { t, useLanguage } from '../i18n';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { ChatComputer } from '../../../../shared/remote-chat/devices';

export function ChatDevices({ devices, choose, chooseLocal, onClose }: {
  devices: ChatComputer[]; choose: (id: string) => void; onClose: () => void; chooseLocal?: () => void;
}) {
  useLanguage();
  return <AdaptiveSheet open title={t("选择电脑")} width={400} onClose={onClose}>
    <div className="chat-settings">
      {chooseLocal && <button type="button" className="chat-setting-entry" onClick={chooseLocal}>
        <strong>本机</strong></button>}
      {devices.map((device) => <button type="button" key={device.deviceId} className="chat-setting-entry"
        disabled={!device.online} onClick={() => choose(device.deviceId)}>
        <strong>{device.name}</strong><span>{device.online ? t("在线") : t("离线")}</span>
      </button>)}
      {!devices.length && <p className="chat-muted">{t("在电脑上打开 Codex Switch 并登录同一账号，即可开始聊天。")}</p>}
    </div>
  </AdaptiveSheet>;
}
