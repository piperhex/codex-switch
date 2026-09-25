import { useEffect } from 'react';

export function useChatViewport(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--chat-height', `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty('--chat-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.style.removeProperty('--chat-height');
      root.style.removeProperty('--chat-top');
    };
  }, [active]);
}
