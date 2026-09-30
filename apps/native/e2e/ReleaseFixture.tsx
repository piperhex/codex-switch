import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { ScrollView, Text } from 'react-native';
import App from '../App';
import { createMobileNativePath, localChatAddresses } from '../src/chat/nativePath';
import type { NativePathOptions } from '../../../shared/remote-chat/nativePath';

const endpoint = 'http://127.0.0.1:15049';
interface Fixture { mode: 'native' | 'app'; options: NativePathOptions }
const payload = 'Android native echo 中文🙂 '.repeat(2048);

async function roundTrip(options: NativePathOptions): Promise<void> {
  if (!createMobileNativePath) throw new Error('Native module missing');
  const path = createMobileNativePath(options);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Direct echo timed out')), 90_000);
      const finish = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      path.onClose(() => finish(new Error('Direct path closed before echo')));
      path.onMessage(text => finish(text === payload ? undefined : new Error('Echo payload differs')));
      path.onOpen(() => {
        path.renew(Date.now() + 120_000);
        path.send(payload);
      });
    });
  } finally { path.close(); }
  if (path.readyState !== 'closed') throw new Error('Path did not close');
  let rejected = false;
  try { path.send('after close'); } catch { rejected = true; }
  if (!rejected) throw new Error('Closed path accepted data');
}

async function check(options: NativePathOptions) {
  const addresses = await localChatAddresses();
  if (!addresses.length) throw new Error('No local addresses');
  await roundTrip(options);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await roundTrip(options);
  return { passed: true, cases: ['native-addresses', 'direct-large-echo', 'renew', 'close', 'reopen-echo'] };
}

function ReleaseFixture() {
  const [fixture, setFixture] = useState<Fixture>();
  const [status, setStatus] = useState('Loading local fixture');
  useEffect(() => {
    void fetch(`${endpoint}/config`).then(response => response.json()).then(async (config: Fixture) => {
      setFixture(config);
      if (config.mode === 'app') return;
      setStatus('Testing native direct connection');
      const result = await check(config.options).catch(error => ({ passed: false, error: String(error) }));
      setStatus(JSON.stringify(result));
      await fetch(`${endpoint}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result) });
    }).catch(error => setStatus(String(error)));
  }, []);
  if (fixture?.mode === 'app') return <App />;
  return <ScrollView contentContainerStyle={{ padding: 32 }}><Text>{status}</Text></ScrollView>;
}

registerRootComponent(ReleaseFixture);
