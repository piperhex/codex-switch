import { useState } from "react";
import { Button, Input, Radio } from "antd";
import { ShieldQuestion } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiEvent } from "./types";
import styles from "./styles.module.less";

export function Approvals({ events, controller }: { events: GuiEvent[]; controller: GuiController }) {
  return <div className={styles.approvals}>{events.map((event) =>
    <Approval key={event.id} event={event} controller={controller} />)}</div>;
}

function Approval({ event, controller }: { event: GuiEvent; controller: GuiController }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { params, method, id } = event;
  if (id == null) return null;
  const questions = params.questions ?? [];
  const isQuestion = method === "item/tool/requestUserInput";
  const isPermissions = method === "item/permissions/requestApproval";
  const decisions = params.availableDecisions;
  const allowAccept = !decisions || decisions.includes("accept");
  const allowDecline = !decisions || decisions.includes("decline");
  const respond = async (decision: "accept" | "decline" | "cancel") => {
    setBusy(true);
    try {
      await controller.respond(isQuestion ? { id, answers: Object.fromEntries(questions.map((question) =>
        [question.id, { answers: answers[question.id]?.trim() ? [answers[question.id].trim()] : [] }])) }
        : { id, decision });
    } finally { setBusy(false); }
  };
  return <div className={styles.approval}>
    <strong><ShieldQuestion size={17} />{isQuestion ? "需要你的补充" : "需要你的确认"}</strong>
    {params.reason && <p>{params.reason}</p>}
    {params.command && <pre>{params.command}</pre>}
    {(params.cwd || params.grantRoot) && <p className={styles.muted}>{params.cwd || params.grantRoot}</p>}
    {isPermissions && <div>
      {params.permissions?.network?.enabled && <p>访问网络</p>}
      {params.permissions?.fileSystem?.read?.map((path) => <p key={path}>读取：{path}</p>)}
      {params.permissions?.fileSystem?.write?.map((path) => <p key={path}>编辑：{path}</p>)}
      {params.permissions?.fileSystem?.entries &&
        <pre>{JSON.stringify(params.permissions.fileSystem.entries, null, 2)}</pre>}
    </div>}
    {questions.map((question) => <div className={styles.question} key={question.id}>
      <label>{question.question}</label>
      {question.options && <Radio.Group value={answers[question.id]} onChange={(event) =>
        setAnswers((values) => ({ ...values, [question.id]: event.target.value }))}>
        {question.options.map((option) => <Radio key={option.label} value={option.label}>
          {option.label}<small>{option.description}</small>
        </Radio>)}
      </Radio.Group>}
      <Input type={question.isSecret ? "password" : "text"} value={answers[question.id] ?? ""}
        placeholder="输入你的回答" aria-label={question.question}
        onChange={(event) => setAnswers((values) => ({ ...values, [question.id]: event.target.value }))} />
    </div>)}
    <div className={styles.approvalActions}>
      {isQuestion ? <Button type="primary" loading={busy}
        disabled={questions.some((question) => !answers[question.id]?.trim())}
        onClick={() => void respond("accept")}>提交回答</Button> : <>
        {allowAccept && <Button type="primary" loading={busy} onClick={() => void respond("accept")}>允许这一次</Button>}
        <Button disabled={busy} onClick={() => void respond(allowDecline ? "decline" : "cancel")}>拒绝</Button>
      </>}
    </div>
  </div>;
}
