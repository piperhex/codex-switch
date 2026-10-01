import { contextUsage } from '../../apps/desktop/src/pages/codexGui/contextUsage';
import { formatCompactTokenCount } from '../../apps/desktop/src/utils/tokenContext';
import type { ThreadTokenUsage } from './client/types';
import { translateText } from '../i18n/translate';
import type { Language } from '../i18n/language';

export function contextUsageLabel(usage?: ThreadTokenUsage, language: Language = 'zh') {
  const t = (text: string, values?: Record<string, string | number>) => translateText(language, text, values);
  const context = contextUsage(usage);
  if (!context) return t('暂无上下文用量');
  const used = formatCompactTokenCount(context.used, language);
  if (context.capacity === null) return t('上下文已用 {used} Token（容量未知）', { used });
  const capacity = formatCompactTokenCount(context.capacity, language);
  return t('上下文 {used} / {capacity} Token（{percent}% 已用）', { used, capacity, percent: context.percent ?? 0 });
}
