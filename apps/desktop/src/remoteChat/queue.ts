import { getGuiController } from '../pages/codexGui/session';
import { composerPatch } from '../../../../shared/remote-chat/composer';
import type { QueueSnapshot } from '../../../../shared/remote-chat/queue';
import type { GuiController } from '../pages/codexGui/controller';
import type { GuiState, SkillReference } from '../pages/codexGui/types';

const MAX_TEXT_LENGTH = 100_000;
const MAX_IMAGES = 12;
const MAX_IMAGE_LENGTH = 8 * 1024 * 1024;
const MAX_PREVIEW_LENGTH = 1000;
const MAX_SKILLS = 100;
const MAX_SKILL_PATH_LENGTH = 4096;

function skillInput(value: unknown): SkillReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SKILLS) throw new Error('技能内容无效，请重新选择。');
  return value.map((skill: unknown) => {
    const fields = skill && typeof skill === 'object' ? skill as Record<string, unknown> : {};
    if (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 200
      || typeof fields.path !== 'string' || !fields.path.trim() || fields.path.length > MAX_SKILL_PATH_LENGTH) {
      throw new Error('技能内容无效，请重新选择。');
    }
    return { name: fields.name, path: fields.path };
  });
}

function preview(text: string) {
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…` : text;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('消息已不可用，请刷新聊天。');
  }
  return value;
}

function messageInput(body: Record<string, unknown>) {
  const { text, images = [] } = body;
  const skills = skillInput(body.skills);
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH || !Array.isArray(images)
    || images.length > MAX_IMAGES || images.some((image) => typeof image !== 'string'
      || image.length > MAX_IMAGE_LENGTH || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(image))
    || (!text.trim() && !images.length && !skills.length)) throw new Error('消息内容无效，请检查后重试。');
  return { text, images: images as string[], skills };
}

/** Adapts the PC queue to compact remote snapshots; transport retries are deduplicated by ChatOperations. */
export class RemoteQueue {
  private source?: GuiState['queued'];
  private snapshot: QueueSnapshot = { revision: 0, threads: {} };
  constructor(private controller: () => GuiController = getGuiController) {}

  read = (): QueueSnapshot => {
    const source = this.controller().getSnapshot().queued;
    if (source === this.source) return this.snapshot;
    this.source = source;
    this.snapshot = { revision: this.snapshot.revision + 1,
      threads: Object.fromEntries(Object.entries(source).filter(([, messages]) => messages.length)
        .map(([id, messages]) => [id, messages.map((item) => ({
          id: item.id, text: preview(item.text || item.attachments?.map((file) => file.name).join('、') || ''),
          imageCount: item.images.length, attachmentCount: item.attachments?.length ?? 0,
          busy: Boolean(item.busy), error: item.error,
        }))])) };
    return this.snapshot;
  };

  subscribe(listener: (snapshot: QueueSnapshot) => void) {
    this.read();
    return this.controller().subscribe(() => {
      const previous = this.snapshot;
      const snapshot = this.read();
      if (previous !== snapshot) listener(snapshot);
    });
  }

  async request(body: Record<string, unknown>) {
    const controller = this.controller();
    if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
    if (controller.getSnapshot().connection !== 'ready') throw new Error('电脑暂未就绪，请稍后重试。');
    if (body.operation === 'queueRead') return this.read();
    const threadId = identifier(body.threadId);
    if (body.operation === 'queueEnqueue') return this.enqueue(controller, threadId, body);
    if (body.operation === 'queueFlush') await controller.queue.flush(threadId);
    else {
      const id = identifier(body.id);
      if (body.operation === 'queueRemove') controller.queue.remove(threadId, id);
      else if (body.operation === 'queueSendNow') {
        if (controller.getSnapshot().conversations[threadId]?.activeTurn) await controller.queue.steer(threadId, id);
        else await controller.queue.flush(threadId);
      } else throw new Error('当前手机端暂不支持此操作。');
    }
    return this.read();
  }

  private async enqueue(controller: GuiController, threadId: string, body: Record<string, unknown>) {
    const input = messageInput(body);
    const patch = composerPatch(Object.fromEntries(['model', 'effort', 'access']
      .filter((key) => body[key] !== undefined).map((key) => [key, body[key]])));
    const settings = { ...controller.getSnapshot().settings, ...patch };
    await controller.loadRemoteThread(threadId);
    if (!controller.queue.enqueue(threadId, input, settings)) throw new Error('待发送消息已满，请稍后再添加。');
    void controller.queue.flush(threadId);
    return this.read();
  }
}

export const remoteQueue = new RemoteQueue();
