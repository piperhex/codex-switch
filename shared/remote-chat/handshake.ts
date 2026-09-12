import { CONNECTION_ERRORS } from './connectionErrors';
import type { GuiEvent } from './client/types';

// Increment only for breaking chat changes. Earlier PCs and phones use the same version without metadata.
export const CHAT_PROTOCOL_VERSION = 1;
export const chatHandshake = { protocolVersion: CHAT_PROTOCOL_VERSION };

export function validateChatHandshake(body: unknown) {
  if (body === undefined) return;
  if (!body || typeof body !== 'object' || !('protocolVersion' in body)
    || body.protocolVersion !== CHAT_PROTOCOL_VERSION) throw new Error(CONNECTION_ERRORS.incompatible);
}

export function chatApprovals(response: unknown): GuiEvent[] {
  // Preserve compatibility with PCs that return approvals directly.
  if (Array.isArray(response)) return response as GuiEvent[];
  validateChatHandshake(response);
  if (!response || typeof response !== 'object' || !('approvals' in response)
    || !Array.isArray(response.approvals)) throw new Error(CONNECTION_ERRORS.invalid);
  return response.approvals as GuiEvent[];
}
