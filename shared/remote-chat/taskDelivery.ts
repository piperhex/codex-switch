/** Transport completion and application acceptance are separate from AI execution. */
export type DeliveryPhase = 'sending' | 'sent' | 'received' | 'unknown';
export interface TaskDelivery {
  requestId: string;
  threadId: string;
  phase: DeliveryPhase;
  afterTurnId?: string;
  afterUserCount?: number;
}

export function taskRequest(request: { id: string; method: string; body?: unknown }): TaskDelivery | undefined {
  const body = request.body as { operation?: string; threadId?: string; objective?: string } | undefined;
  if (request.method !== 'request' || !body?.threadId) return;
  const task = ['send', 'steer', 'queueEnqueue'].includes(body.operation ?? '')
    || (body.operation === 'goalSet' && typeof body.objective === 'string');
  if (task) return { requestId: request.id, threadId: body.threadId, phase: 'sending' };
}

export function mergeTaskDelivery(previous: TaskDelivery | undefined, incoming: TaskDelivery): TaskDelivery {
  if (!previous || incoming.phase === 'sending') return incoming;
  if (previous.requestId !== incoming.requestId) return previous;
  // A fast response may arrive before the local transport promise settles.
  if (previous.phase === 'received' || (previous.phase === 'unknown' && incoming.phase === 'sent')) return previous;
  return { ...previous, ...incoming };
}
