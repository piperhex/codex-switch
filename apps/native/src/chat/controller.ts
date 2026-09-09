import type { AuthSession } from '../types';
import { ChatController as SharedController } from '../../../../shared/remote-chat/client/controller';
import { MobileChatConnection } from './connection';

export class ChatController extends SharedController {
  constructor(session: AuthSession, deviceId: string) {
    super((events) => new MobileChatConnection({ session, deviceId, ...events }));
  }
}
