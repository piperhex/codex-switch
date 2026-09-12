import { useRef, useState } from "react";
import { Input, Radio } from "antd";
import { pendingAsyncQuestions } from "./asyncQuestionState";
import type { Conversation, Item } from "./types";
import { submitQuestionOnEnter } from "./questionKeyboard";
import layout from "./styles.module.less";
import styles from "./AsyncQuestions.module.less";

export interface AsyncQuestionsProps {
  value?: Conversation;
  disabled?: boolean;
  onAnswer: (item: Item, answers: string[]) => Promise<boolean>;
}

export function AsyncQuestions({ value, ...props }: AsyncQuestionsProps) {
  return <div className={layout.questionWrap}>
    {pendingAsyncQuestions(value).map((item) => <QuestionCard key={`${value?.thread.id}:${item.id}`}
      item={item} {...props} />)}
  </div>;
}

function QuestionCard({ item, disabled, onAnswer }: Omit<AsyncQuestionsProps, "value"> & { item: Item }) {
  const questions = item.questions ?? [];
  const [answers, setAnswers] = useState(() => questions.map((question) => question.options?.[0] ?? ""));
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);
  const setAnswer = (index: number, answer: string) =>
    setAnswers((previous) => previous.map((value, position) => position === index ? answer : value));
  const submit = async () => {
    if (submitting.current || disabled || answers.some((answer) => !answer.trim())) return;
    submitting.current = true;
    setBusy(true);
    try { setSubmitted(await onAnswer(item, answers)); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (submitted) return null;
  return <section className={styles.card} aria-label="需要你的补充" aria-busy={busy}
    onKeyDown={(event) => submitQuestionOnEnter(event, submit)}>
    <strong>需要你的补充</strong>
    {questions.map((question, index) => <fieldset key={index} disabled={disabled || busy}>
      <legend>{question.title}</legend>
      {Boolean(question.options?.length) && <Radio.Group value={answers[index]} disabled={disabled || busy}
        onChange={(event) => setAnswer(index, event.target.value)}>
        {question.options?.map((option) => <Radio key={option} value={option}>{option}</Radio>)}
      </Radio.Group>}
      <Input.TextArea aria-label={question.title} placeholder="输入回答，按回车发送"
        autoSize={{ minRows: 1, maxRows: 4 }} disabled={disabled || busy}
        value={answers[index] ?? ""} onChange={(event) => setAnswer(index, event.target.value)} />
    </fieldset>)}
    <small className={styles.hint}>Enter 发送 · Shift + Enter 换行</small>
  </section>;
}
