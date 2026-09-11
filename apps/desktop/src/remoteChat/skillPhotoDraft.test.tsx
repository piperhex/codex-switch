// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';

const skill = { name: 'review', path: '/skills/review/SKILL.md', description: '检查代码', enabled: true };
const images = ['data:image/jpeg;base64,aW1hZ2U='];
let root: Root;
let container: HTMLDivElement;
let draft: ReturnType<typeof useChatDraft>;
let options: Parameters<typeof useChatDraft>[0];
function Harness() { draft = useChatDraft(options); return null; }
async function render(patch: Partial<typeof options> = {}) {
  options = { ...options, ...patch };
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
  options = { threadId: null, sending: false, disabled: false,
    selection: { model: 'astra', effort: 'high', access: 'workspace-write' }, send: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('retains skill references after a failed first photo send and clears them only after a successful retry', async () => {
  let finish!: (sent: boolean) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }))
    .mockResolvedValue(true);
  await render({ send });
  await act(async () => draft.insertSkill({ start: 0, end: 0 }, skill));
  let pending!: Promise<boolean>;
  await act(async () => { pending = draft.submit({ images }); });
  await render({ threadId: 'created', sending: true });
  await act(async () => finish(false));
  expect(await pending).toBe(false);
  expect(draft.text).toContain('$review');
  await render({ sending: false });
  await act(async () => { expect(await draft.submit({ images })).toBe(true); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ images,
    skills: [{ name: skill.name, path: skill.path }], text: expect.stringContaining('$review') }));
  expect(draft.text).toBe('');
});

it('sends native photo-only input and does not erase a different chat draft after a late acknowledgement', async () => {
  let finish!: (sent: boolean) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  await render({ threadId: 'first', send });
  let pending!: Promise<boolean>;
  await act(async () => { pending = draft.submit({ images }); });
  expect(send).toHaveBeenCalledWith({ text: '', images, ...options.selection });
  await render({ threadId: 'second' });
  await act(async () => draft.setText('另一条消息'));
  await act(async () => finish(true));
  expect(await pending).toBe(false);
  expect(draft.text).toBe('另一条消息');
});

it('sends an attachment-only first message and preserves text and attachments on retry', async () => {
  const attachments = [{ kind: 'file' as const, name: 'note.txt', path: '', data: 'aGVsbG8=' }];
  const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  await render({ send });
  await act(async () => { expect(await draft.submit({ attachments })).toBe(false); });
  await act(async () => { expect(await draft.submit({ attachments })).toBe(true); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenNthCalledWith(1, { text: '', images: [], attachments, ...options.selection });
  expect(send).toHaveBeenNthCalledWith(2, { text: '', images: [], attachments, ...options.selection });
});
