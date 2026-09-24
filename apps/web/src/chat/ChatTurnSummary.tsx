import { t, useLanguage } from '../i18n';
import { ChevronRight, FileText } from 'lucide-react';
import { useContext, useMemo } from 'react';
import { DetailsContext } from '../../../desktop/src/pages/codexGui/detailsContext';
import { ChatFilesSummary } from './ChatFilesSummary';
import type { Turn } from './types';
import { completedTurnFiles } from '../../../../shared/chat/turnPresentation';
import { generatedImageSource } from '../../../../shared/chat/imageSources';
import { ChatImage } from './ChatImage';

export type TurnPanel = 'plan' | 'changes' | 'error';
export function turnErrorNotice(turn: Turn) {
  if (turn.status === 'failed' || turn.error) return t("本次回复遇到问题，可以继续发送消息重试。");
  if (turn.status === 'completed') return t("本次回复曾出现连接中断，现已恢复。");
  if (turn.status === 'interrupted') return t("本次回复曾出现连接中断。");
  return t("连接暂时中断，Codex 正在重试…");
}

export function ChatTurnSummary({ turn, onOpen, hideStopped = false }: {
  turn: Turn; onOpen: (panel: TurnPanel) => void; hideStopped?: boolean;
}) {
  useLanguage();
  const details = useContext(DetailsContext);
  const files = useMemo(() => completedTurnFiles(turn), [turn]);
  const generated = [...new Set(turn.items.filter(item => item.type === 'imageGeneration'
    && item.status === 'completed' && !item.failure).map(generatedImageSource).filter(Boolean))];
  const paths = [...new Set(files.map(file => file.path))];
  return <section className="chat-turn-summary">
    {generated.map(source => <ChatImage key={source} source={source} description={t("生成的图片")} />)}
    {!!turn.plan?.length && <button type="button" className="chat-plan-summary" aria-label={t("查看任务计划")}
      onClick={() => onOpen('plan')}><strong>{t("任务计划")}</strong>
      <span>{turn.plan.filter(step => step.status === 'completed').length}/{turn.plan.length}</span>
      <ChevronRight size={15} /></button>}
    {!!files.length && (details ? <ChatFilesSummary files={files} /> : <div className="chat-files-summary">
      <button type="button" aria-label={t("查看本轮修改：{value1} 个文件", { value1: paths.length })} onClick={() => onOpen('changes')}>
        <FileText size={21} /><strong>{t("已编辑")} {paths.length}  {t("个文件")}</strong>
        <b className="chat-added">+{files.reduce((sum, file) => sum + file.added, 0)}</b>
        <b className="chat-removed">−{files.reduce((sum, file) => sum + file.removed, 0)}</b><span>{t("审核")}</span>
      </button>
      {paths.slice(0, 3).map(path => <button key={path} type="button" onClick={() => onOpen('changes')}>
        <span className="chat-ellipsis">{path}</span></button>)}
      {paths.length > 3 && <button type="button" onClick={() => onOpen('changes')}>{t("再显示")} {paths.length - 3}  {t("个文件")}</button>}
    </div>)}
    {turn.status === 'interrupted' && !hideStopped && <p className="chat-muted">{t("已停止生成")}</p>}
    {(turn.error || turn.retryError || turn.status === 'failed') && <button type="button"
      className="chat-error-notice" aria-label={t("查看报错详情")} onClick={() => onOpen('error')}>
      {turnErrorNotice(turn)} <u>{t("查看报错详情")}</u></button>}
  </section>;
}
