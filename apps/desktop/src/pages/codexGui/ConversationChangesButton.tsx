import { useId, useMemo } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { Button, Tooltip } from "antd";
import type { Conversation } from "./types";
import { changedFiles, parseDiff } from "./diff";
import { useDetailsEntry } from "./detailsContext";

export function ConversationChangesButton({ value }: { value?: Conversation }) {
  const id = useId();
  const turn = value?.turns.slice().reverse().find((entry) => entry.diff
    || entry.items.some((item) => item.type === "fileChange" && item.changes?.length));
  const netFiles = useMemo(() => parseDiff(turn?.diff ?? ""), [turn?.diff]);
  const files = useMemo(() => turn?.diff ? netFiles : (turn?.items ?? [])
    .filter((item) => item.type === "fileChange" && !["failed", "declined", "inProgress"].includes(item.status ?? ""))
    .flatMap((item) => changedFiles(item.changes ?? [])), [turn?.diff, turn?.items, netFiles]);
  const entry = useMemo(() => ({ id, title: "文件更改", files }), [id, files]);
  const panel = useDetailsEntry(entry);
  const label = panel?.visible ? "收起文件更改" : "查看文件更改";
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" icon={panel?.visible ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
      aria-label={label} aria-expanded={Boolean(panel?.visible)}
      onClick={() => panel?.visible ? panel.close() : panel?.open(entry)} />
  </Tooltip>;
}
