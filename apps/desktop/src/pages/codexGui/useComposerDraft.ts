import { useRef, useState, type ClipboardEvent } from "react";
import type { GuiController } from "./controller";
import type { ComposerText } from "./types";
import { MAX_ATTACHMENTS, type AttachmentReference } from "./attachmentTypes";
import { MAX_REPLY_QUOTES, MAX_QUOTE_CHARACTERS, quoteKey, quotedReply, type ReplyQuote } from "./replyQuotes";
import { queuedMessageText } from "./queuedMessageDraft";

export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export interface DraftImage { id: string; name: string; url?: string }
interface Draft extends ComposerText {
  images: DraftImage[];
  attachments?: AttachmentReference[];
  quotes?: ReplyQuote[];
}
const EMPTY_DRAFT: Draft = { text: "", mentions: [], images: [] };

export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result) : reject(new Error("Invalid image"));
    reader.onerror = reader.onabort = () => reject(new Error("Image read failed"));
    reader.readAsDataURL(file);
  });
}

export function useComposerDraft(key: string, controller: GuiController) {
  const submitting = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draft = drafts[key] ?? EMPTY_DRAFT;
  const update = (change: (value: Draft) => Draft) => setDrafts((values) =>
    ({ ...values, [key]: change(values[key] ?? EMPTY_DRAFT) }));
  const editText = (text: string) => update((value) => ({ ...value, text, mentions: [] }));
  const editContent = (content: ComposerText) => update((value) => ({ ...value, ...content }));
  const editQueued = (id: string) => {
    if (submitting.current) return false;
    const message = controller.queue.take(key, id);
    if (!message) return false;
    const restored: Draft = { ...queuedMessageText(message), attachments: message.attachments,
      images: message.images.map((url, index) => ({ id: crypto.randomUUID(), name: `图片 ${index + 1}`, url })) };
    update(() => restored);
    return true;
  };
  const addQuote = (quote: ReplyQuote) => {
    if (!quote.text.trim() || !quote.messageId) return false;
    if (quote.text.length > MAX_QUOTE_CHARACTERS) {
      controller.report("引用内容太长，请选择短一些的片段。"); return false;
    }
    if (draft.quotes?.some((item) => quoteKey(item) === quoteKey(quote))) return true;
    if ((draft.quotes?.length ?? 0) >= MAX_REPLY_QUOTES) {
      controller.report("每条消息最多添加 8 条引用。"); return false;
    }
    update((value) => ({ ...value, quotes: [...new Map([...(value.quotes ?? []), quote]
      .map((item) => [quoteKey(item), item])).values()].slice(0, MAX_REPLY_QUOTES) }));
    return true;
  };
  const removeQuote = (key: string) => update((value) =>
    ({ ...value, quotes: value.quotes?.filter((item) => quoteKey(item) !== key) }));
  const clearQuotes = () => update((value) => ({ ...value, quotes: [] }));
  const addAttachments = (attachments: AttachmentReference[]) => {
    if ((draft.attachments?.length ?? 0) + attachments.length > MAX_ATTACHMENTS) {
      controller.report("每条消息最多添加 32 个文件、文件夹或插件。");
    }
    update((value) => ({ ...value, attachments: [...new Map([...(value.attachments ?? []), ...attachments]
      .map((item) => [item.path, item])).values()].slice(0, MAX_ATTACHMENTS) }));
  };
  const removeAttachment = (path: string) => update((value) =>
    ({ ...value, attachments: value.attachments?.filter((item) => item.path !== path) }));
  const removeImage = (id: string) => update((value) =>
    ({ ...value, images: value.images.filter((image) => image.id !== id) }));
  const addImages = (files: File[]) => {
    const valid = files.filter((file) => IMAGE_TYPES.includes(file.type) && file.size > 0
      && file.size <= MAX_IMAGE_BYTES);
    if (valid.length !== files.length) controller.report("请添加 PNG、JPG、WebP 或 GIF 图片，每张不超过 20 MB。");
    if (valid.length + draft.images.length > MAX_IMAGES) controller.report("每条消息最多添加 8 张图片。");
    const additions = valid.slice(0, MAX_IMAGES - draft.images.length)
      .map((file) => ({ file, id: crypto.randomUUID() }));
    update((value) => ({ ...value, images: [...value.images,
      ...additions.map(({ file, id }) => ({ id, name: file.name }))].slice(0, MAX_IMAGES) }));
    for (const { file, id } of additions) {
      void readImage(file).then((url) => update((value) => ({ ...value,
        images: value.images.map((image) => image.id === id ? { ...image, url } : image) })))
        .catch(() => { removeImage(id); controller.report("图片读取失败，请重新粘贴或选择图片。"); });
    }
  };
  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    addImages(files);
  };
  const reading = draft.images.some((image) => !image.url);
  const send = async () => {
    if (reading || submitting.current) return;
    submitting.current = true;
    const skills = [...new Map(draft.mentions.map(({ skill }) =>
      [skill.path, { name: skill.name, path: skill.path }])).values()];
    try {
      const images = draft.images.flatMap((image) => image.url ? [image.url] : []);
      const text = quotedReply(draft.text, draft.quotes);
      const accepted = draft.attachments?.length
        ? await controller.send(text, images, skills, draft.attachments)
        : await controller.send(text, images, skills);
      if (accepted) {
        setDrafts((values) => values[key] === draft ? { ...values, [key]: EMPTY_DRAFT } : values);
      } else {
        const selected = key === "new" ? controller.getSnapshot().selected ?? "new" : key;
        setDrafts((values) => values[key] !== draft || selected === key || values[selected]
          ? values : { ...values, [key]: EMPTY_DRAFT, [selected]: draft });
      }
    } finally { submitting.current = false; }
  };
  return { draft, reading, editText, editContent, removeImage, addImages, paste, send, addAttachments, removeAttachment,
    addQuote, removeQuote, clearQuotes, editQueued };
}
