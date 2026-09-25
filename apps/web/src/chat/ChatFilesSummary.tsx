import { useId, useMemo } from 'react';
import type { DiffFile } from '../../../../shared/chat/diff';
import { EditedFilesSummary } from '../../../desktop/src/pages/codexGui/EditedFilesSummary';
import { useDetailsEntry } from '../../../desktop/src/pages/codexGui/detailsContext';
import { ChatChangesPill } from './ChatChangesPill';

/** Remote paths are review buttons; they never invoke the viewing computer's file actions. */
export function ChatFilesSummary({ files, title = '本轮修改', status, compact = false }: {
  files: DiffFile[]; title?: string; status?: string; compact?: boolean;
}) {
  const id = useId();
  const entry = useMemo(() => ({ id, files, title, status }), [id, files, title, status]);
  const panel = useDetailsEntry(entry);
  if (!panel || !files.length) return null;
  if (compact) return <ChatChangesPill files={files} onOpen={() => panel.open(entry)} />;
  return <EditedFilesSummary files={files} title={title} status={status}
    onReview={() => panel.open(entry)} onReviewFile={filePath => panel.open({ ...entry, filePath })} />;
}
