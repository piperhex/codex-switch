import type { ChatState } from './client/types';
import { CONNECTION_ERRORS } from './connectionErrors';
import { HOST_IDENTITY_CHANGED } from './trustedHost';

export type ConnectionStage = 'login' | 'computer' | 'path' | 'chat' | 'ready';
export interface HealthStep { label: string; status: 'ok' | 'waiting' | 'blocked'; detail: string }
export interface ConnectionHealth { title: string; next: string; steps: HealthStep[]; reconnect: boolean }

const LOGIN_ERRORS: readonly string[] = [CONNECTION_ERRORS.authorization, CONNECTION_ERRORS.expired];
const COMPUTER_ERRORS: readonly string[] = [CONNECTION_ERRORS.unavailable, CONNECTION_ERRORS.interrupted];
const CHAT_ERRORS: readonly string[] = [CONNECTION_ERRORS.gui, CONNECTION_ERRORS.guiTimeout,
  CONNECTION_ERRORS.guiDisconnected, CONNECTION_ERRORS.missingGui, CONNECTION_ERRORS.startup,
  CONNECTION_ERRORS.workspace, CONNECTION_ERRORS.configuration];

export function liveChat(state: ChatState) {
  return state.ready && ['direct', 'relay'].includes(state.mode) && !state.historyOffline;
}

function connectionFacts(state: ChatState, device?: { online: boolean }) {
  const issue = state.connectionIssue ?? '';
  const path = state.mode === 'direct' || state.mode === 'relay';
  const ready = liveChat(state);
  const loginBlocked = !path && LOGIN_ERRORS.includes(issue);
  const computerBlocked = !path && (device?.online === false || COMPUTER_ERRORS.includes(issue));
  const loginOk = !loginBlocked && (path || ['path', 'chat', 'ready'].includes(state.connectionStage ?? ''));
  return { state, issue, ready, path, loginBlocked, computerBlocked, loginOk, device: Boolean(device) };
}

type Facts = ReturnType<typeof connectionFacts>;

function stepStatus(ok: boolean, blocked: boolean): HealthStep['status'] {
  if (ok) return 'ok';
  return blocked ? 'blocked' : 'waiting';
}

function loginStep(facts: Facts): HealthStep {
  const status = stepStatus(facts.loginOk, facts.loginBlocked);
  const details = { ok: '登录验证已通过。', blocked: '请重新登录，并确认两端使用同一账号。', waiting: '正在验证登录状态。' };
  return { label: '账号登录', status, detail: details[status] };
}

function computerStep(facts: Facts): HealthStep {
  const contacted = facts.path || (!facts.computerBlocked && facts.state.connectionStage === 'path');
  const status = stepStatus(contacted, facts.computerBlocked);
  const details = { ok: '已联系到电脑。', blocked: '请唤醒电脑、连接网络，并保持 Remote AI 运行。',
    waiting: '正在联系电脑，请确认电脑已开机。' };
  return { label: '电脑在线', status, detail: details[status] };
}

function pathStep(facts: Facts): HealthStep {
  let detail = '尚未建立可用连接，正在尝试直连和中转。';
  if (facts.path) detail = facts.state.mode === 'direct' ? '已直连电脑。' : '正在通过中转连接，聊天可正常使用。';
  return { label: '连接线路', status: stepStatus(facts.path, false), detail };
}

function chatStep(facts: Facts): HealthStep {
  const ready = facts.ready && !facts.state.desktopOnly;
  return { label: '电脑聊天', status: stepStatus(ready, CHAT_ERRORS.includes(facts.issue)),
    detail: ready ? '聊天已就绪。' : '连接后将同步任务、消息和待确认事项。' };
}

/** Live transport evidence takes precedence over potentially stale presence records. */
export function connectionHealth(state: ChatState, device?: { online: boolean }): ConnectionHealth {
  const facts = connectionFacts(state, device);
  return { ...healthSummary(facts), steps: [loginStep(facts), computerStep(facts), pathStep(facts), chatStep(facts)],
    reconnect: Boolean(device) && !facts.ready && !state.connecting };
}

function healthSummary(input: Facts) {
  const { state, issue, loginBlocked } = input;
  if (!input.device) return { title: '尚未选择电脑', next: '请先选择要连接的电脑。' };
  if (loginBlocked) return { title: '需要重新登录', next: '请返回账号页重新登录，再连接电脑。' };
  if (issue === HOST_IDENTITY_CHANGED) return { title: '需要核对电脑身份', next: '请关闭体检，点击“核对电脑身份”后继续。' };
  if (state.desktopOnly) return { title: '电脑尚未登录', next: '请打开远程桌面，登录电脑后再连接聊天。' };
  return transportSummary(input);
}

function transportSummary({ state, issue, ready, path, computerBlocked }: Facts) {
  if (ready) return { title: state.mode === 'direct' ? '已直连电脑' : '已通过中转连接',
    next: state.mode === 'direct' ? '连接正常，可以发送任务。' : '连接正常，可以发送任务；中转不会阻止 AI 执行。' };
  if (computerBlocked) return { title: '暂时联系不到电脑', next: '请唤醒电脑并打开 Remote AI，然后点击“重新连接”。' };
  if (path) return { title: '正在恢复电脑上的聊天', next: CHAT_ERRORS.includes(issue)
    ? issue : '请稍候；若长时间未完成，请在电脑上打开聊天并检查账号和模型。' };
  if (issue === CONNECTION_ERRORS.network || issue === CONNECTION_ERRORS.server) {
    return { title: '聊天服务暂时连不上', next: '请检查当前网络和服务器地址，然后重新连接。' };
  }
  return { title: '正在建立连接', next: '请保持两端联网；仍未连接时，可点击“重新连接”再试。' };
}
