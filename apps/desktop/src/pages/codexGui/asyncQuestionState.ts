import type { Conversation, Item, Turn } from "./types";

/** Async questions are agent messages; a later user message answers or supersedes them. */
export function pendingAsyncQuestions(value?: Conversation): Item[] {
  let pending: Item[] = [];
  for (const turn of value?.turns ?? []) {
    for (const item of turn.items) {
      if (item.type === "userMessage") pending = remainingQuestions(pending, item);
      if (item.type === "agentMessage" && item.delivery === "async" && item.questions?.length) pending.push(item);
    }
  }
  return pending;
}

function remainingQuestions(pending: Item[], message: Item): Item[] {
  if (!pending.length) return pending;
  const text = (message.content ?? []).map((part) => typeof part === "object" ? part.text ?? "" : part).join("\n");
  const answered = pending.filter((item) => item.questions?.every((question) => text.includes(`${question.title}\n`)));
  // Keep other cards when submitting a structured answer; ordinary chat supersedes older prompts.
  return answered.length ? pending.filter((item) => !answered.includes(item)) : [];
}

export function asyncAnswerText(item: Item, answers: string[]): string | null {
  if (!item.questions?.length || answers.length !== item.questions.length || answers.some((answer) => !answer.trim())) {
    return null;
  }
  return item.questions.map((question, index) => `${question.title}\n${answers[index].trim()}`).join("\n\n");
}

export function withAsyncAnswer(turn: Turn, text: string, userMessageIndex: number): Turn {
  if (turn.items.filter((item) => item.type === "userMessage").length > userMessageIndex) return turn;
  return { ...turn, items: [...turn.items, { id: `sent-${crypto.randomUUID()}`, type: "userMessage",
    localEcho: true, content: [{ type: "text", text }] }] };
}
