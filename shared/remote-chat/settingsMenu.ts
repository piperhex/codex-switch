import type { Model } from './client/types';
import { ACCESS_OPTIONS, EFFORT_LABELS, type ComposerSettings } from './composer';

export type SettingField = keyof ComposerSettings;
export const SETTINGS_FIELDS = [
  { field: 'model', label: '模型', title: '选择模型' },
  { field: 'effort', label: '推理强度', title: '推理强度' },
  { field: 'speed', label: '速度模式', title: '选择速度模式' },
  { field: 'access', label: '访问权限', title: '访问权限' },
] satisfies { field: SettingField; label: string; title: string }[];
export interface SettingOption { value: string; label: string; description?: string }

export function settingOptions(field: SettingField, models: Model[], selection: ComposerSettings): SettingOption[] {
  if (field === 'speed') return [
    { value: 'normal', label: '普通模式' },
    { value: 'fast', label: '快速模式', description: '与电脑端同步，对后续消息生效。' },
  ];
  if (field === 'access') return ACCESS_OPTIONS;
  if (field === 'model') return models.map((model) => ({
    value: model.model, label: model.displayName || model.model,
  }));
  const model = models.find((entry) => entry.model === selection.model);
  return (model?.supportedReasoningEfforts ?? []).map(({ reasoningEffort }) => ({
    value: reasoningEffort, label: EFFORT_LABELS[reasoningEffort] || reasoningEffort,
  }));
}

export function visibleSettingsFields(selection: ComposerSettings) {
  // Older computers do not advertise speed control; avoid offering a setting they cannot save.
  return SETTINGS_FIELDS.filter(({ field }) => field !== 'speed' || selection.speed !== undefined);
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
