import { useEffect, useRef, useState } from 'react';
import { ChatImageError, MAX_CHAT_IMAGES, validateChatImages, type DraftImage } from '../attachments';
import type { SendInput } from './types';
import type { AttachmentReference } from '../../../apps/desktop/src/pages/codexGui/attachmentTypes';
import type { ComposerSettings } from '../composer';
import type { Skill } from './types';
import { draftSkills, editSkillDraft, emptySkillDraft, insertDraftSkill, type TextSelection } from './skillDraft';

interface Options {
  threadId: string | null;
  sending: boolean;
  disabled: boolean;
  selection: ComposerSettings;
  send: (input: SendInput) => Promise<boolean>;
}

export function useChatDraft({ threadId, sending, disabled, selection, send }: Options) {
  const [content, setContent] = useState(emptySkillDraft);
  const { text } = content;
  const setText = (value: string) => setContent((draft) => editSkillDraft(draft, value));
  const insertSkill = (range: TextSelection, skill: Skill) =>
    setContent((draft) => insertDraftSkill(draft, range, skill));
  const removeText = (range: TextSelection, expected: string) => setContent((draft) => draft.text === expected
    ? editSkillDraft(draft, expected.slice(0, range.start) + expected.slice(range.end)) : draft);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const scope = useRef(threadId);
  const generation = useRef(0);
  const busy = useRef(false);
  const submitting = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    if (scope.current === threadId) return;
    // Creating a thread during the first send must not discard a failed draft.
    const creating = scope.current === null && submitting.current;
    scope.current = threadId;
    if (creating) return;
    generation.current += 1;
    busy.current = false;
    submitting.current = false;
    setText(''); setImages([]); setError(''); setPicking(false);
  }, [threadId]);

  const addImages = async (pick: (remaining: number) => Promise<DraftImage[]>) => {
    if (busy.current || submitting.current || sending) return;
    const current = generation.current;
    busy.current = true; setPicking(true); setError('');
    try {
      if (images.length >= MAX_CHAT_IMAGES) throw new ChatImageError(`一次最多添加 ${MAX_CHAT_IMAGES} 张图片。`);
      const selected = await pick(MAX_CHAT_IMAGES - images.length);
      if (current !== generation.current || !selected.length) return;
      validateChatImages([...images, ...selected].map((image) => image.url));
      setImages((existing) => [...existing, ...selected]);
    } catch (cause) {
      if (current === generation.current) {
        setError(cause instanceof ChatImageError ? cause.message : '暂时无法添加图片，请重新选择。');
      }
    } finally {
      if (current === generation.current) { busy.current = false; setPicking(false); }
    }
  };
  const submit = async (override: { text?: string; images?: string[]; attachments?: AttachmentReference[] } = {}) => {
    const submittedText = override.text ?? text;
    const submittedImages = override.images ?? images.map((image) => image.url);
    if (disabled || sending || busy.current || submitting.current
      || (!submittedText.trim() && !submittedImages.length && !override.attachments?.length)) return false;
    const current = generation.current;
    submitting.current = true; setError('');
    try {
      const skills = draftSkills(content);
      const sent = await send({ text: submittedText, images: submittedImages, ...selection,
        ...(override.attachments?.length ? { attachments: override.attachments } : {}),
        ...(skills.length ? { skills } : {}) });
      if (!sent || current !== generation.current) return false;
      setContent((value) => value.text === text ? emptySkillDraft() : value);
      setImages((value) => value.filter((image) => !images.includes(image)));
      return true;
    } catch {
      if (current === generation.current) setError('消息未发送，请稍后重试。');
      return false;
    } finally {
      if (current === generation.current) submitting.current = false;
    }
  };
  const removeImage = (id: string) => {
    if (sending || busy.current || submitting.current) return;
    setImages((value) => value.filter((image) => image.id !== id)); setError('');
  };
  return { text, setText, insertSkill, removeText, images, error, picking, addImages, removeImage, submit,
    hasContent: Boolean(text.trim() || images.length) };
}
