import { useEffect, useRef, useState } from 'react';
import { ChatImageError, MAX_CHAT_IMAGES, validateChatImages, type DraftImage } from '../attachments';
import type { SendInput } from './types';
import type { ComposerSettings } from '../composer';

interface Options {
  threadId: string | null;
  sending: boolean;
  disabled: boolean;
  selection: ComposerSettings;
  send: (input: SendInput) => Promise<boolean>;
}

export function useChatDraft({ threadId, sending, disabled, selection, send }: Options) {
  const [text, setText] = useState('');
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
  const submit = async () => {
    if (disabled || sending || busy.current || submitting.current || (!text.trim() && !images.length)) return;
    const current = generation.current;
    submitting.current = true; setError('');
    try {
      const sent = await send({ text, images: images.map((image) => image.url), ...selection });
      if (!sent || current !== generation.current) return;
      setText((value) => value === text ? '' : value);
      setImages((value) => value.filter((image) => !images.includes(image)));
    } catch {
      if (current === generation.current) setError('消息未发送，请稍后重试。');
    } finally {
      if (current === generation.current) submitting.current = false;
    }
  };
  const removeImage = (id: string) => {
    if (sending || busy.current || submitting.current) return;
    setImages((value) => value.filter((image) => image.id !== id)); setError('');
  };
  return { text, setText, images, error, picking, addImages, removeImage, submit,
    hasContent: Boolean(text.trim() || images.length) };
}
