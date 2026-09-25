import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopVersionSheet } from '../src/settings/DesktopVersionSheet';
import '../src/styles.css';

const connectionOptions = {
  authorize: async () => ({ baseUrl: 'http://127.0.0.1:1459', accessToken: 'fixture-only' }),
};
function Harness() {
  const [open, setOpen] = useState(true);
  return <main style={{ padding: 24 }}><h1>设置</h1>
    <button onClick={() => setOpen(true)}>电脑端版本</button>
    {open && <DesktopVersionSheet onClose={() => setOpen(false)} connectionOptions={connectionOptions} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
