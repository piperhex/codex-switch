import { PROCESSING_LABELS } from '../../../apps/desktop/src/pages/codexGui/processing';
import { guiText } from '../../../apps/desktop/src/i18n/guiText';
import { formatTurnDuration, SECOND_MS } from '../../../apps/desktop/src/pages/codexGui/turnTiming';
import type { ChatState, Turn } from './types';
import { useProcessingSeconds } from './useProcessingSeconds';

export interface ChatProcessingProps {
  turn: Turn;
  active: boolean;
  processing?: ChatState['processing'];
}

export function useProcessingStatus({ turn, active, processing }: ChatProcessingProps) {
  const current = processing?.turnId === turn.id ? processing : undefined;
  const { phaseSeconds, totalSeconds } = useProcessingSeconds(turn, active, current?.startedAtMs);
  const phase = current?.phase ?? 'request';
  const total = formatTurnDuration(totalSeconds * SECOND_MS, { compactHours: true });
  const totalLabel = guiText('(共计{duration})', { duration: total });
  return { phase, label: `${PROCESSING_LABELS[phase]} · ${formatTurnDuration(phaseSeconds * SECOND_MS)} ${totalLabel}` };
}
