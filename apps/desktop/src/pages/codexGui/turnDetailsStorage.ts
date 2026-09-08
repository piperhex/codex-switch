import type { Conversation, PlanStep, Turn } from "./types";

const STORAGE_KEY = "codex-switch:gui-turn-details:v1";
const MAX_RECORDS = 30;
const MAX_CACHE_CHARACTERS = 500_000;
interface TurnDetails {
  threadId: string; turnId: string; diff?: string; plan?: PlanStep[]; planExplanation?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validDetails(value: unknown): value is TurnDetails {
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.turnId !== "string") return false;
  if (value.diff !== undefined && typeof value.diff !== "string") return false;
  if (value.planExplanation != null && typeof value.planExplanation !== "string") return false;
  return value.plan === undefined || (Array.isArray(value.plan) && value.plan.every((step) =>
    isRecord(step) && typeof step.step === "string" && typeof step.status === "string"));
}

function readRecords(): TurnDetails[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_CACHE_CHARACTERS) return [];
    const records: unknown = JSON.parse(raw);
    return Array.isArray(records) ? records.filter(validDetails).slice(-MAX_RECORDS) : [];
  } catch { return []; } // Browser privacy settings can disable optional session storage.
}

/** app-server history has file items, but does not replay turn plan/net-diff notifications. */
export function cachedTurnDetails(threadId: string): Map<string, Partial<Turn>> {
  return new Map(readRecords().filter((record) => record.threadId === threadId).map((record) =>
    [record.turnId, { diff: record.diff, plan: record.plan, planExplanation: record.planExplanation }]));
}

export function rememberTurnDetails(value: Conversation, turnId: string) {
  const turn = value.turns.find((entry) => entry.id === turnId);
  if (!turn || (turn.diff === undefined && turn.plan === undefined)) return;
  const records = readRecords().filter((record) => record.threadId !== value.thread.id || record.turnId !== turnId);
  records.push({ threadId: value.thread.id, turnId, diff: turn.diff, plan: turn.plan,
    planExplanation: turn.planExplanation });
  while (records.length > MAX_RECORDS || JSON.stringify(records).length > MAX_CACHE_CHARACTERS) records.shift();
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  catch { /* History file items remain available if the optional cache reaches the browser quota. */ }
}
