import * as Crypto from 'expo-crypto';
import type { AccountSummary } from '../types';
import { ApiError, requestCodexDirect } from './client';

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const DEFAULT_OFFICIAL_MODEL = 'gpt-5.6-sol';
const QUOTA_CONSUMPTION_PROMPT = '今天天气如何？';
const QUOTA_CONSUMPTION_CONCURRENCY = 4;
const QUOTA_CONSUMPTION_TIMEOUT_MS = 120_000;

export interface QuotaConsumptionFailure {
  accountId: string;
  message: string;
}

export interface BatchQuotaConsumptionResult {
  consumedAccounts: AccountSummary[];
  failures: QuotaConsumptionFailure[];
}

function quotaConsumptionBody() {
  return {
    model: DEFAULT_OFFICIAL_MODEL,
    instructions: '',
    input: [
      { type: 'additional_tools', role: 'developer', tools: [] },
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: "Answer the user's question briefly." }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: QUOTA_CONSUMPTION_PROMPT }],
      },
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'low', context: 'all_turns' },
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content'],
    text: { verbosity: 'low' },
  };
}

function quotaConsumptionCompleted(body: string) {
  return body.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((data) => data && data !== '[DONE]')
    .some((data) => {
      try {
        const event: unknown = JSON.parse(data);
        return event !== null
          && typeof event === 'object'
          && 'type' in event
          && event.type === 'response.completed';
      } catch {
        return false;
      }
    });
}

export function quotaConsumptionTargets(accounts: readonly AccountSummary[]) {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    if (!account.codexAccessToken?.trim() || seen.has(account.id)) return false;
    seen.add(account.id);
    return true;
  });
}

export async function consumeAccountQuota(account: AccountSummary): Promise<void> {
  const conversationId = Crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUOTA_CONSUMPTION_TIMEOUT_MS);
  try {
    const response = await requestCodexDirect(account, CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'session-id': conversationId,
        'thread-id': conversationId,
        'x-openai-internal-codex-responses-lite': 'true',
      },
      body: JSON.stringify(quotaConsumptionBody()),
      signal: controller.signal,
    });
    if (!quotaConsumptionCompleted(await response.text())) {
      throw new ApiError('Codex 未确认额度消耗完成，请稍后重试');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError('Codex 请求超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function failureMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '额度消耗失败';
}

export async function consumeAccountsQuota(
  accounts: readonly AccountSummary[],
): Promise<BatchQuotaConsumptionResult> {
  const targets = quotaConsumptionTargets(accounts);
  const consumedAccounts: AccountSummary[] = [];
  const failures: QuotaConsumptionFailure[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(QUOTA_CONSUMPTION_CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const account = targets[cursor];
      cursor += 1;
      if (!account) continue;
      try {
        await consumeAccountQuota(account);
        consumedAccounts.push(account);
      } catch (error) {
        failures.push({ accountId: account.id, message: failureMessage(error) });
      }
    }
  });
  await Promise.all(workers);
  return { consumedAccounts, failures };
}
