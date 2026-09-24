import styles from './terminal.module.less';

const KEYS = [['Ctrl+C', '\x03'], ['Tab', '\t'], ['Esc', '\x1b'], ['↑', '\x1b[A'],
  ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']] as const;

export function TerminalKeys({ input }: { input: (data: string) => void }) {
  return <div className={styles.keys}>{KEYS.map(([label, data]) =>
    <button key={label} type="button" onPointerDown={event => event.preventDefault()}
      onClick={() => input(data)}>{label}</button>)}</div>;
}
