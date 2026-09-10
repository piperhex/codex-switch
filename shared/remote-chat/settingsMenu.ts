import type { Model } from './client/types';
import { ACCESS_OPTIONS, EFFORT_LABELS, type ComposerSettings } from './composer';

export type SettingField = keyof ComposerSettings;
export const SETTINGS_FIELDS = [
  { field: 'model', label: '模型', title: '选择模型' },
  { field: 'effort', label: '推理强度', title: '推理强度' },
  { field: 'access', label: '访问权限', title: '访问权限' },
] satisfies { field: SettingField; label: string; title: string }[];
export interface SettingOption { value: string; label: string; description?: string }

export function settingOptions(field: SettingField, models: Model[], selection: ComposerSettings): SettingOption[] {
  if (field === 'access') return ACCESS_OPTIONS;
  if (field === 'model') return models.map((model) => ({
    value: model.model, label: model.displayName || model.model,
  }));
  const model = models.find((entry) => entry.model === selection.model);
  return (model?.supportedReasoningEfforts ?? []).map(({ reasoningEffort }) => ({
    value: reasoningEffort, label: EFFORT_LABELS[reasoningEffort] || reasoningEffort,
  }));
}

export function settingValue(field: SettingField, models: Model[], selection: ComposerSettings) {
  return settingOptions(field, models, selection).find((option) => option.value === selection[field])?.label
    || selection[field] || '正在同步…';
}

export function settingsNotice({ saving, ready, error }: { saving: boolean; ready: boolean; error: string }) {
  if (error) return error;
  if (!saving) return '';
  return ready ? '正在保存设置…' : '已保留选择，连接后自动保存。';
}
