import { useState } from 'react';
import type { ApprovalReply, GuiEvent } from './types';

export function ChatApproval({ event, ready, respond }: {
  event: GuiEvent; ready: boolean; respond: (reply: ApprovalReply) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { params, method, id } = event;
  if (id == null) return null;
  const questions = params.questions ?? [];
  const isQuestion = method === 'item/tool/requestUserInput';
  const send = async (decision: 'accept' | 'decline' | 'cancel') => {
    setBusy(true);
    try {
      await respond(isQuestion ? { id, answers: Object.fromEntries(questions.map((question) =>
        [question.id, { answers: [answers[question.id]?.trim() ?? ''] }])) } : { id, decision });
    } finally { setBusy(false); }
  };
  return <section className="chat-approval" aria-label={isQuestion ? '需要你的补充' : '需要你的确认'}>
    <h2>{isQuestion ? '需要你的补充' : '需要你的确认'}</h2>
    {params.reason && <p className="chat-muted">{params.reason}</p>}
    {params.command && <pre>{params.command}</pre>}
    {(params.cwd || params.grantRoot) && <p className="chat-muted">{params.cwd || params.grantRoot}</p>}
    {params.permissions?.network?.enabled && <p className="chat-muted">访问网络</p>}
    {params.permissions?.fileSystem?.read?.map((path) => <p key={path} className="chat-muted">读取：{path}</p>)}
    {params.permissions?.fileSystem?.write?.map((path) => <p key={path} className="chat-muted">编辑：{path}</p>)}
    {questions.map((question) => <fieldset key={question.id} disabled={busy || !ready}>
      <legend>{question.question}</legend>
      {question.options?.map((option) => <label className="chat-choice" key={option.label}>
        <input type="radio" name={`${id}-${question.id}`} checked={answers[question.id] === option.label}
          onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))} />
        <span><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
      <input className="chat-answer" aria-label={question.question} placeholder="输入你的回答"
        type={question.isSecret ? 'password' : 'text'} autoComplete="off" value={answers[question.id] ?? ''}
        onChange={(change) => setAnswers((current) => ({ ...current, [question.id]: change.target.value }))} />
    </fieldset>)}
    <div className="chat-row">
      {(isQuestion || !params.availableDecisions || params.availableDecisions.includes('accept')) &&
        <button type="button" className="chat-button chat-primary"
          disabled={!ready || busy || (isQuestion && questions.some((question) => !answers[question.id]?.trim()))}
          onClick={() => { void send('accept'); }}>{isQuestion ? '提交回答' : '允许这一次'}</button>}
      {!isQuestion && <button type="button" className="chat-button" disabled={!ready || busy}
        onClick={() => { void send(params.availableDecisions?.includes('decline') === false ? 'cancel' : 'decline'); }}>
        拒绝</button>}
    </div>
  </section>;
}
