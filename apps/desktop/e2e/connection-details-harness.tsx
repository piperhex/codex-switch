import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { MobileConnectionStatus } from '../src/pages/codexGui/MobileConnectionStatus';
import { connectionDetails } from '../src/remoteChat/connectionDetails';
import { mobileConnection } from '../src/remoteChat/mobileConnection';
import 'antd/dist/reset.css';

function Harness() {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    connectionDetails.open('pixel-9-session', { name: 'Pixel 9', platform: 'Android' });
    connectionDetails.open('windows-edge-session', { name: 'Windows · Edge', platform: 'Windows' });
    connectionDetails.update('pixel-9-session', { mode: 'relay' });
    connectionDetails.update('windows-edge-session', { mode: 'direct' });
    connectionDetails.traffic('windows-edge-session', { uploadBytes: 1024, downloadBytes: 1024 });
    connectionDetails.quota({ monthUsedBytes: 48 * 1024 ** 2, monthlyLimitBytes: 1024 ** 3,
      resetAt: '2026-10-01T00:00:00+08:00' }, false);
    mobileConnection.setConnected(true);
    let bytes = 2 * 1024 ** 2;
    const timer = setInterval(() => {
      bytes += 1024;
      connectionDetails.traffic('pixel-9-session', { uploadBytes: bytes, downloadBytes: 128 * 1024 });
    }, 250);
    return () => { clearInterval(timer); connectionDetails.reset(); mobileConnection.setConnected(false); };
  }, []);
  return <ConfigProvider><main style={{ margin: 40, fontFamily: 'sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}><MobileConnectionStatus /></div>
    <button onClick={() => setClicks(value => value + 1)}>界面响应检查 {clicks}</button>
    <button onClick={() => { connectionDetails.reset(); mobileConnection.setConnected(false); }}>断开测试设备</button>
  </main></ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
