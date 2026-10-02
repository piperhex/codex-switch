import { t, useLanguage } from '../i18n';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import type { Turn } from './types';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { completedTurnFiles } from '../../../../shared/chat/turnPresentation';
import { requestErrorDetails } from '../../../desktop/src/pages/codexGui/requestError';
import { turnErrorNotice, type TurnPanel } from './ChatTurnSummary';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatDiff } from './ChatDiff';
import { ChatCodeBlock } from './ChatCodeBlock';
import { TaskReviewPanel } from './review/TaskReviewPanel';

const TITLES = { get plan() { return t("任务计划"); }, get changes() { return t("本轮修改"); },
  get error() { return t("报错详情"); }, get result() { return t('任务验收'); } };
export function ChatTurnDetails({ turn, panel, onClose }: { turn: Turn; panel: TurnPanel; onClose: () => void }) {
  useLanguage();
  const error = turn.error ?? turn.retryError;
  return <AdaptiveSheet open title={TITLES[panel]} width={760} onClose={onClose}
    presentation={panel === 'changes' || panel === 'result' ? 'drawer' : 'adaptive'}>
    <div className="chat-detail-stack">
      {panel === 'result' && <TaskReviewPanel key={turn.id} turn={turn} />}
      {panel === 'changes' && <ChatDiff files={completedTurnFiles(turn)} />}
      {panel === 'error' && <ChatCodeBlock label={t("报错详情")} copyLabel={t("复制报错详情")}
        text={error ? requestErrorDetails(error) : turnErrorNotice(turn)} />}
      {panel === 'plan' && <>
        {turn.planExplanation && <ChatMarkdown text={turn.planExplanation} />}
        {turn.plan?.map((step, index) => {
          const Icon = step.status === 'completed' ? CheckCircle2 : step.status === 'inProgress' ? LoaderCircle : Circle;
          const label = { completed: t("已完成"), inProgress: t("进行中"), pending: t("待开始") }[step.status] || t("待开始");
          return <div className="chat-plan-step" key={index}><Icon size={17} />
            <span>{step.step}</span><small>{label}</small></div>;
        })}
      </>}
    </div>
  </AdaptiveSheet>;
}
