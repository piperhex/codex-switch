export const TITLE_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export interface TitleSettings {
  model: string;
  effort: typeof TITLE_REASONING_EFFORTS[number];
}
export const DEFAULT_TITLE_SETTINGS: TitleSettings = { model: 'gpt-5.6-luna', effort: 'low' };
export const TITLE_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;

/** Missing settings are compatible with administrators running an older server. */
export function parseTitleSettings(value: unknown): TitleSettings {
  if (value === undefined) return { ...DEFAULT_TITLE_SETTINGS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写有效的起名设置。');
  const { model, effort } = value as Record<string, unknown>;
  if (typeof model !== 'string' || !TITLE_MODEL_PATTERN.test(model.trim())
    || !TITLE_REASONING_EFFORTS.some((entry) => entry === effort)) throw new Error('请检查起名模型和推理强度。');
  return { model: model.trim(), effort: effort as TitleSettings['effort'] };
}
