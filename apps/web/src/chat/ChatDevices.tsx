import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { RemoteDevice } from '../types';

export function ChatDevices({ devices, choose, onClose }: {
  devices: RemoteDevice[]; choose: (id: string) => void; onClose: () => void;
}) {
  return <AdaptiveSheet open title="选择电脑" width={400} onClose={onClose}>
    <div className="chat-settings">
      {devices.map((device) => <button type="button" key={device.deviceId} className="chat-setting-entry"
        disabled={!device.online} onClick={() => choose(device.deviceId)}>
        <strong>{device.name}</strong><span>{device.online ? '在线' : '离线'}</span>
      </button>)}
      {!devices.length && <p className="chat-muted">在电脑上打开 Codex Switch 并登录同一账号，即可开始聊天。</p>}
    </div>
  </AdaptiveSheet>;
}
