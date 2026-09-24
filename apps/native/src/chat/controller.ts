import type { AuthSession } from '../types';
import { ChatController as SharedController } from '../../../../shared/remote-chat/client/controller';
import { MobileChatConnection } from './connection';
import { SqliteHistoryStore } from './offline/store';
import { createHistoryPreparer } from './historyPreparation';
import { AsyncHistoryVersionCache } from '../../../../shared/remote-chat/client/historyPreparation';

export class ChatController extends SharedController {
  constructor(session: AuthSession, deviceId: string) {
    const prepare = createHistoryPreparer();
    super((events) => new MobileChatConnection({ session, deviceId, ...events }),
      new SqliteHistoryStore(session, deviceId, prepare), prepare ? new AsyncHistoryVersionCache(prepare) : undefined);
  }
}
