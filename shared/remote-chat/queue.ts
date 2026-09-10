export const QUEUE_EVENT = 'chat/queue/updated';

/** Phone previews omit image data and PC-only attachment paths. The PC owns all pending messages. */
export interface QueueMessage {
  id: string;
  text: string;
  imageCount: number;
  attachmentCount: number;
  busy: boolean;
  error?: string;
}
export interface QueueSnapshot { revision: number; threads: Record<string, QueueMessage[]> }
export const emptyQueue = (): QueueSnapshot => ({ revision: -1, threads: {} });
export type QueueAction = 'queueSendNow' | 'queueRemove' | 'queueFlush';
