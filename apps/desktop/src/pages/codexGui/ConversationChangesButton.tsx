import { useId, useMemo } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { Button, Tooltip } from "antd";
import type { Conversation } from "./types";
import { useTurnChangedFiles } from "./useTurnChangedFiles";
import { useDetailsEntry } from "./detailsContext";
import { useDiffText } from "../../../../../shared/chat/diffText";

export function ConversationChangesButton({ value }: { value?: Pick<Conversation, 'turns'> }) {
  const t = useDiffText();
  const id = useId();
  const turn = value?.turns.slice().reverse().find((entry) => entry.diff
    || entry.items.some((item) => item.type === "fileChange" && item.changes?.length));
  const files = useTurnChangedFiles(turn);
  const entry = useMemo(() => ({ id, title: "文件更改", files }), [id, files]);
  const panel = useDetailsEntry(entry);
  const label = t(panel?.visible ? "收起文件更改" : "查看文件更改");
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={panel?.visible ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
      aria-label={label} aria-expanded={Boolean(panel?.visible)}
      onClick={() => panel?.visible ? panel.close() : panel?.open(entry)} />
  </Tooltip>;
}
