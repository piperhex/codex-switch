import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatConnectionHealth } from '../src/chat/ChatConnectionHealth';
import { initialChatState, type ChatState } from '../../../shared/remote-chat/client/types';
import '../src/styles.css';

function Harness() {
  const [state, setState] = useState<ChatState>({ ...initialChatState(), mode: 'relay', ready: true,
    publicEndpoints: {
      local: [{ host: '203.0.113.8', port: 42123, protocol: 'udp' }],
      remote: [{ host: '2001:db8:1234:5678:abcd:ef01:2345:6789', port: 65535, protocol: 'tcp' }],
    } });
  return <ChatConnectionHealth state={state} device={{ online: true }}
    close={() => setState({ ...initialChatState(), connecting: true })} reconnect={() => undefined} />;
}

createRoot(document.getElementById('root')!).render(<Harness />);
