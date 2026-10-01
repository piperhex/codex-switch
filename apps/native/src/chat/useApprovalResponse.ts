import { t } from '../i18n';
import { useRef, useState } from 'react';
import type { ApprovalReply, GuiEvent } from './types';
import { approvalResponse, type ApprovalAnswers, type ApprovalDecision } from './approvalResponse';

interface Options { event: GuiEvent; answers: ApprovalAnswers; respond: (reply: ApprovalReply) => Promise<void> }

export function useApprovalResponse({ event, answers, respond }: Options) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const send = async (decision: ApprovalDecision) => {
    if (submitting.current) return;
    const reply = approvalResponse(event, decision, answers);
    if (!reply) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try { await respond(reply); }
    catch { setError(t("提交失败，请重试。")); }
    finally { submitting.current = false; setBusy(false); }
  };
  return { busy, error, send };
}
