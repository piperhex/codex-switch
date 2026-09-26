import { useMemo } from 'react';
import { gitGraph, GRAPH_ROW_HEIGHT } from '../../../../../shared/remote-chat/gitGraph';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';
import { t, getLocale } from '../../i18n';

export function GitHistory({ panel, connected }: { panel: RemoteGit; connected: boolean }) {
  const graph = useMemo(() => gitGraph(panel.commits), [panel.commits]);
  return <div className="git-history">
    {!panel.busy && !panel.commits.length && <p className="git-notice">{t('还没有提交记录。')}</p>}
    {graph.rows.map(row => <button type="button" key={row.commit.hash} className="git-history-row"
      disabled={!connected || panel.busy} onClick={() => panel.setDetail({ kind: 'files', commit: row.commit })}>
      <svg width={graph.width} height={GRAPH_ROW_HEIGHT} aria-hidden="true" style={{ flexShrink: 0 }}>
        {row.lines.map((line, index) => <line key={index} {...line} stroke={line.color} strokeWidth="2" />)}
        <circle cx={row.x} cy={GRAPH_ROW_HEIGHT / 2} r="4" fill={row.color} stroke="white" strokeWidth="1.5" />
      </svg>
      <span className="git-history-text"><strong>{row.commit.subject}</strong>
        <span className="git-refs">{row.commit.refs.map(ref => <em key={ref}>{ref}</em>)}</span>
        <small>{row.commit.hash.slice(0, 8)} · {row.commit.author} · {
          new Date(row.commit.date).toLocaleString(getLocale())}</small>
      </span>
    </button>)}
    {panel.hasMore && <button type="button" className="git-more" disabled={panel.busy || !connected}
      onClick={() => void panel.more()}>{t('加载更多提交')}</button>}
  </div>;
}
