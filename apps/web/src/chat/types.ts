export type * from '../../../../shared/remote-chat/client/types';
export type { ChatController } from '../../../../shared/remote-chat/client/controller';

export interface SendInput {
  text: string;
  model?: string;
  effort?: string;
  access: 'read-only' | 'workspace-write';
}
