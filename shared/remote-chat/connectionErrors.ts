export const CONNECTION_ERRORS = {
  incompatible: '手机端与电脑端的聊天版本不兼容，请将两端的 Codex Switch 更新到最新版本后重试。',
  unavailable: '电脑的聊天连接尚未就绪。请确认电脑已联网，并打开 Codex Switch、登录同一云端账号；旧版请先更新。',
  network: '无法连接聊天服务，请检查手机网络和服务器地址后重试。',
  authorization: '聊天连接验证未通过，请重新登录，并确认手机与电脑使用同一云端账号。',
  expired: '登录已过期，请在手机上重新登录后连接电脑。',
  server: '聊天服务暂时不可用，请稍后重试。',
  limit: '这台电脑的聊天连接数已满，请断开其他手机上的聊天后重试。',
  interrupted: '电脑的聊天连接已中断，请检查电脑网络，并保持 Codex Switch 运行。',
  timeout: '连接电脑超时，请确认电脑未休眠、Codex Switch 正在运行，且两端网络正常。',
  invalid: '未能识别连接信息，请更新手机和电脑上的 Codex Switch 后重试。',
  missingGui: '电脑未检测到 Codex GUI 所需的程序，请在电脑的 Codex GUI 页面下载 Codex 后重试。',
  startup: '电脑上的 Codex GUI 启动失败，请在电脑上打开 Codex GUI，检查配置后重试。',
  guiTimeout: '电脑上的 Codex GUI 响应超时，请在电脑上检查运行状态后重试。',
  guiDisconnected: '电脑上的 Codex GUI 已断开，请在电脑上重新打开 Codex GUI 后重试。',
  workspace: '电脑无法准备聊天，请在电脑上打开 Codex GUI，检查文件夹是否可访问后重试。',
  configuration: '电脑上的 Codex GUI 未能完成连接，请检查电脑上的账号、模型和 Codex 配置。',
  gui: '未能连接电脑上的 Codex GUI，请在电脑上打开 Codex GUI，确认可正常使用后重试。',
} as const;

export function socketConnectionError(code: number) {
  switch (code) {
    case 4001: return CONNECTION_ERRORS.authorization;
    case 4004: return CONNECTION_ERRORS.unavailable;
    case 4008: return CONNECTION_ERRORS.limit;
    case 1001: case 1011: case 1012: case 1013: return CONNECTION_ERRORS.server;
    default: return CONNECTION_ERRORS.network;
  }
}

export function authorizationError(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const message = error instanceof Error ? error.message : error;
  // The H5 login layer predates status-bearing errors; recognize only its known login messages.
  if (['登录已过期，请重新登录', '请先登录', '请重新登录后连接电脑。'].includes(String(message))) {
    return CONNECTION_ERRORS.expired;
  }
  if (status === 401) return CONNECTION_ERRORS.expired;
  if (status === 403) return CONNECTION_ERRORS.authorization;
  if (typeof status === 'number' && status >= 500) return CONNECTION_ERRORS.server;
  return CONNECTION_ERRORS.network;
}

const GUI_ERRORS = new Map<string, string>([
  ['请先下载 Codex，即可开始对话。', CONNECTION_ERRORS.missingGui],
  ['Codex 暂时无法启动，请检查 Codex 配置后重试。', CONNECTION_ERRORS.startup],
  ['Codex 响应超时，请检查连接状态。', CONNECTION_ERRORS.guiTimeout],
  ['Codex 已断开连接，请重新连接后继续。', CONNECTION_ERRORS.guiDisconnected],
  ['暂时无法准备对话，请稍后重试。', CONNECTION_ERRORS.workspace],
  ['Codex 未能完成操作，请检查当前账户、模型和 Codex 配置。', CONNECTION_ERRORS.configuration],
  ['当前手机端暂不支持此操作。', CONNECTION_ERRORS.incompatible],
]);

/** Translate known desktop errors without sending paths or raw platform failures to the phone. */
export function guiConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : error;
  if (typeof message !== 'string') return CONNECTION_ERRORS.gui;
  if (Object.values(CONNECTION_ERRORS).some((known) => known === message)) return message;
  return GUI_ERRORS.get(message) ?? CONNECTION_ERRORS.gui;
}
