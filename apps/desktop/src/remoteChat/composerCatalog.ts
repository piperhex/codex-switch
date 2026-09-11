import { guiApi } from '../pages/codexGui/api';
import type { PluginsResponse } from '../pages/codexGui/attachmentTypes';
import type { SkillsResponse } from '../pages/codexGui/types';
import { remoteSkills } from '../../../../shared/remote-chat/skills';
import { remotePlugins } from '../../../../shared/remote-chat/composerCatalog';

const PLUGINS_UNAVAILABLE = '部分插件暂未加载，可继续选择已有内容。';

export async function composerCatalog(result: SkillsResponse, body: Record<string, unknown>) {
  const skills = remoteSkills(result);
  if (!body.includePlugins) return skills;
  try {
    const plugins = await guiApi.request<PluginsResponse>({ operation: 'plugins',
      cwd: typeof body.cwd === 'string' ? body.cwd : undefined });
    return { ...skills, plugins: remotePlugins(plugins),
      pluginsError: plugins.marketplaceLoadErrors.length ? PLUGINS_UNAVAILABLE : '' };
  } catch { return { ...skills, plugins: [], pluginsError: PLUGINS_UNAVAILABLE }; }
}
