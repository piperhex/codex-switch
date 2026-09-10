import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { keepChatConnected } from './backgroundConnection';

export function useChatBackground(enabled: boolean) {
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const start = () => {
      if (AppState.currentState !== 'active') return;
      void keepChatConnected(true).then(() => setError(''))
        .catch(() => setError('后台聊天暂未开启，请重新打开应用后重试。'));
    };
    start();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') start(); });
    return () => {
      subscription.remove();
      void keepChatConnected(false).catch(() => console.warn('Could not stop chat background service.'));
    };
  }, [enabled]);
  return error;
}
