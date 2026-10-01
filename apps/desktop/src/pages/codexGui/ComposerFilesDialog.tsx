import { guiText } from "../../i18n/guiText";
import { useState } from "react";
import { Button, Input, Modal, Segmented } from "antd";
import { File, Folder, ImagePlus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktopApp } from "../../api/backend";
import { folderName } from "./projectCatalog";
import type { AttachmentReference } from "./attachmentTypes";
import styles from "./ComposerExtras.module.less";

export function ComposerFilesDialog({ onAdd, onImages, onClose, onError }: {
  onAdd: (files: AttachmentReference[]) => void; onImages: () => void;
  onClose: () => void; onError: (message: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [kind, setKind] = useState<"file" | "folder">("file");
  const [path, setPath] = useState("");
  const choose = async (kind: "file" | "folder") => {
    if (choosing) return;
    setChoosing(true);
    try {
      const selected = await open({ directory: kind === "folder", multiple: true,
        title: kind === "folder" ? guiText("添加文件夹") : guiText("添加文件") });
      if (selected) {
        const paths = typeof selected === "string" ? [selected] : selected;
        onAdd(paths.map((path) => ({ kind, name: folderName(path), path })));
        onClose();
      }
    } catch { onError(guiText("未能选择文件，请稍后重试。")); }
    finally { setChoosing(false); }
  };
  const confirm = () => {
    if (!path.trim()) return;
    onAdd([{ kind, name: folderName(path.trim()), path: path.trim() }]); onClose();
  };
  return <Modal open centered title={guiText("添加文件和文件夹")} width={400} footer={null} onCancel={onClose}
    closable={!choosing} maskClosable={!choosing} keyboard={!choosing}>
    <div className={styles.fileChoices}>
      <Button icon={<ImagePlus size={18} />} disabled={choosing} onClick={() => { onImages(); onClose(); }}>
        {guiText("添加图片")}</Button>
      {isDesktopApp ? <>
        <Button icon={<File size={18} />} disabled={choosing} onClick={() => void choose("file")}>{guiText("添加文件")}</Button>
        <Button icon={<Folder size={18} />} disabled={choosing} onClick={() => void choose("folder")}>{guiText("添加文件夹")}</Button>
      </> : <>
        <Segmented value={kind} options={[{ label: guiText("文件"), value: "file" }, { label: guiText("文件夹"), value: "folder" }]}
          onChange={setKind} />
        <Input aria-label={guiText("附件路径")} placeholder={guiText("输入完整路径")} value={path}
          onChange={(event) => setPath(event.target.value)} onPressEnter={confirm} />
        <p className={styles.copy}>{guiText("填写运行 Remote AI 的主机上的文件或文件夹路径。")}</p>
        <Button type="primary" disabled={!path.trim()} onClick={confirm}>{guiText("添加")}</Button>
      </>}
    </div>
  </Modal>;
}
