import { memo, useId, useMemo, type ReactNode } from "react";
import { DiffDocument, type DiffDocumentProps } from "./DiffDocument";
import { EditedFilesSummary } from "./EditedFilesSummary";
import { FileMenu } from "./FileMenu";
import { useDetailsEntry } from "./detailsContext";

export { DiffDocument } from "./DiffDocument";

export const DiffView = memo(function DiffView({ files, title = "文件修改", status, undo }:
  DiffDocumentProps & { undo?: ReactNode }) {
  const id = useId();
  const entry = useMemo(() => ({ id, files, title, status }), [id, files, title, status]);
  const panel = useDetailsEntry(entry);
  if (!files.length) return null;
  if (!panel) return <>{undo}<DiffDocument files={files} title={title} status={status} /></>;
  return <EditedFilesSummary files={files} title={title} status={status} undo={undo}
    renderFile={props => <FileMenu {...props}>{props.path}</FileMenu>}
    onReview={() => panel.open(entry)} onReviewFile={(filePath) => panel.open({ ...entry, filePath })} />;
});
