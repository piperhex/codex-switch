import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { chooseSkillArchive, chooseSkillFolder, publishSkill } from "../../api/backend";
import type { FeedbackImageInput, SkillMarketItem, SkillPackageSelection } from "../../types";
import { prepareSkillPreview } from "../../utils/feedbackImages";
import type { PublishModalProps } from "./types";

export interface PreparedPreview {
  file: File;
  url: string;
  compressed: boolean;
}

function fileToInput(file: File): Promise<FeedbackImageInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      mimeType: file.type,
      dataBase64: String(reader.result).split(",", 2)[1] ?? "",
    });
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read preview image"));
    reader.readAsDataURL(file);
  });
}

function nextVersion(editing?: SkillMarketItem | null) {
  if (!editing) return "1.0.0";
  const match = editing.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : editing.version;
}

export function useSkillPublishForm({ editing, onClose, onPublished, t }: PublishModalProps) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [version, setVersion] = useState(nextVersion(editing));
  const [selection, setSelection] = useState<SkillPackageSelection | null>(null);
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, []);

  const choosePackage = async (kind: SkillPackageSelection["kind"]) => {
    setError(null);
    try {
      const next = kind === "archive" ? await chooseSkillArchive() : await chooseSkillFolder();
      if (next) setSelection(next);
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    }
  };

  const choosePreview = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparingPreview(true);
    setError(null);
    try {
      const prepared = await prepareSkillPreview(file);
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          file: prepared.file,
          url: URL.createObjectURL(prepared.file),
          compressed: prepared.compressed,
        };
      });
    } catch (caught) {
      setError((caught as Error).message === "unsupported"
        ? t("skills.preview.unsupported")
        : t("skills.preview.compressFailed"));
    } finally {
      setPreparingPreview(false);
    }
  };

  const submit = async () => {
    if (!title.trim() || !description.trim() || !version.trim() || !selection) return;
    setSubmitting(true);
    setError(null);
    try {
      await publishSkill({
        skillId: editing?.id,
        title: title.trim(),
        description: description.trim(),
        version: version.trim(),
        package: selection,
        preview: preview ? await fileToInput(preview.file) : null,
      });
      await onPublished();
      onClose();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
      setSubmitting(false);
    }
  };

  return {
    busy: submitting || preparingPreview,
    choosePackage,
    choosePreview,
    description,
    error,
    preparingPreview,
    preview,
    selection,
    setDescription,
    setPreview,
    setTitle,
    setVersion,
    submit,
    submitting,
    title,
    version,
  };
}
