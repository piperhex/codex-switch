import { useId, useMemo } from "react";
import { FileDiff } from "lucide-react";
import { Button } from "antd";
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
  return <Button type="text" icon={<FileDiff size={16} />} disabled={!files.length}
    aria-label="查看文件更改" onClick={() => panel?.open(entry)}>更改</Button>;
}
