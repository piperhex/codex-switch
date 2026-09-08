import { useRef, useState, type ClipboardEvent } from "react";
import type { GuiController } from "./controller";
import type { ComposerText } from "./types";

export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export interface DraftImage { id: string; name: string; url?: string }
interface Draft extends ComposerText { images: DraftImage[] }
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
      if (await controller.send(draft.text, draft.images.flatMap((image) => image.url ? [image.url] : []), skills)) {
        setDrafts((values) => values[key] === draft ? { ...values, [key]: EMPTY_DRAFT } : values);
      } else {
        const selected = controller.getSnapshot().selected ?? "new";
        setDrafts((values) => ({ ...values, [key]: EMPTY_DRAFT, [selected]: draft }));
      }
    } finally { submitting.current = false; }
  };
  return { draft, reading, editText, editContent, removeImage, addImages, paste, send };
}
