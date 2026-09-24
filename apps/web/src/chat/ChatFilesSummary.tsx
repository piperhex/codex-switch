import { useId, useMemo } from 'react';
import type { DiffFile } from '../../../../shared/chat/diff';
import { EditedFilesSummary } from '../../../desktop/src/pages/codexGui/EditedFilesSummary';
import { useDetailsEntry } from '../../../desktop/src/pages/codexGui/detailsContext';

/** Remote paths are review buttons; they never invoke the viewing computer's file actions. */
export function ChatFilesSummary({ files, title = '本轮修改', status }: {
  files: DiffFile[]; title?: string; status?: string;
}) {
  const id = useId();
  const entry = useMemo(() => ({ id, files, title, status }), [id, files, title, status]);
  const panel = useDetailsEntry(entry);
  if (!panel || !files.length) return null;
  return <EditedFilesSummary files={files} title={title} status={status}
    onReview={() => panel.open(entry)} onReviewFile={filePath => panel.open({ ...entry, filePath })} />;
}
