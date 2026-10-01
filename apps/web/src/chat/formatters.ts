import { getLanguage } from '../i18n';
import { contextUsageLabel as formatContextUsage } from '../../../../shared/remote-chat/contextUsage';
import type { ThreadTokenUsage } from './types';

export { formatTurnDuration } from '../../../desktop/src/pages/codexGui/turnTiming';
export const contextUsageLabel = (usage?: ThreadTokenUsage) => formatContextUsage(usage, getLanguage());
