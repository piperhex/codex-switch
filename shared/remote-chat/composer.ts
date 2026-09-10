import type { AccessMode, Model } from './client/types';
import { object } from './protocol';

export interface ComposerSettings { model: string; effort: string; access: AccessMode }
export interface ComposerSnapshot { models: Model[]; settings: ComposerSettings; revision: number }
export interface ComposerModelsResponse { data: Model[]; nextCursor: string | null; composer?: ComposerSnapshot }
export const COMPOSER_EVENT = 'chat/composer/updated';
export const DEFAULT_COMPOSER: ComposerSettings = { model: '', effort: '', access: 'workspace-write' };
export const EFFORT_LABELS: Record<string, string> = {
  none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: 'Ultra',
};

export function composerLabel(models: Model[], settings: ComposerSettings) {
  const model = models.find((entry) => entry.model === settings.model);
  const name = model?.displayName || settings.model;
  if (!name) return '正在同步模型…';
  const effort = EFFORT_LABELS[settings.effort] || settings.effort;
  return effort ? `${name} · ${effort}` : name;
}
export const ACCESS_OPTIONS = [
  { value: 'read-only', label: '请求批准', description: '需要更多权限时，先由你确认。' },
  { value: 'workspace-write', label: '帮我批准', description: '自动判断风险，批准安全操作。' },
  { value: 'danger-full-access', label: '完全访问', description: '可访问电脑上的所有文件和网络，无需逐次确认。' },
] satisfies { value: AccessMode; label: string; description: string }[];

export function composerPatch(value: unknown): Partial<ComposerSettings> {
  const input = object(value);
  if (Object.keys(input).some((key) => !['model', 'effort', 'access'].includes(key))) {
    throw new Error('聊天设置无效，请重新选择。');
  }
  for (const key of ['model', 'effort'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 200)) {
      throw new Error('请选择有效的模型和思考深度。');
    }
  }
  if (input.access !== undefined && !ACCESS_OPTIONS.some((option) => option.value === input.access)) {
    throw new Error('请选择有效的访问权限。');
  }
  return input as Partial<ComposerSettings>;
}
