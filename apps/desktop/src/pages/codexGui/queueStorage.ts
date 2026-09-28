import { invoke } from '../../api/backend';
import type { QueueSnapshot, QueueStorage } from './queueJournal';

export const queueStorage: QueueStorage = {
  read: () => invoke<QueueSnapshot>('codex_gui_queue_read'),
  save: snapshot => invoke<QueueSnapshot>('codex_gui_queue_save', { snapshot }),
};
