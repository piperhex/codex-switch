import type { GuiEvent, GuiState } from "./types";
import { processingApproval, restoreProcessing } from "./processing";

export function trackProcessingApproval(state: GuiState, event: GuiEvent): GuiState {
  const resolved = event.method === "serverRequest/resolved";
  const request = resolved ? state.approvals.find((entry) => entry.id === event.params.requestId) : event;
  if (request?.id == null || !request.params.threadId) return state;
  const id = request.params.threadId;
  const value = state.conversations[id];
  const turn = value?.turns.find((entry) => entry.id === value.activeTurn);
  if (!turn || (request.params.turnId && request.params.turnId !== turn.id)) return state;
  const processing = processingApproval(restoreProcessing(turn, value.processing), request, resolved);
  return { ...state, conversations: { ...state.conversations, [id]: { ...value, processing } } };
}
