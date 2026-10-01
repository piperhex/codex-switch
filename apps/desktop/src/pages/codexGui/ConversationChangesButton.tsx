import { guiText } from "../../i18n/guiText";
import { useEffect, useId, useMemo } from "react";
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
  const entry = useMemo(() => ({ id, title: guiText("文件更改"), files }), [id, files]);
  const panel = useDetailsEntry(entry);
  const register = panel?.setConversationChanges;
  useEffect(() => { register?.(entry); }, [register, entry]);
  const showingChanges = Boolean(panel?.visible && panel.showingChanges);
  const label = t(showingChanges ? "收起文件更改" : "查看文件更改");
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={showingChanges ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
      aria-label={label} aria-expanded={showingChanges}
      onClick={() => showingChanges ? panel?.close() : panel?.open(entry)} />
  </Tooltip>;
}
