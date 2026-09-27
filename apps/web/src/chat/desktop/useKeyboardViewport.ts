import { useEffect, useState, type CSSProperties } from 'react';

/** Mobile browsers can shrink only the visual viewport when the keyboard opens. */
export function useKeyboardViewport(active: boolean): CSSProperties | undefined {
  const [bounds, setBounds] = useState<{ height: number; top: number }>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () => setBounds({ height: viewport.height, top: viewport.offsetTop });
    update();
    viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update);
    };
  }, [active]);
  return active && bounds ? { ...bounds, bottom: 'auto' } : undefined;
}
