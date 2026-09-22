const TAB_OPERATIONS = new Set([
  'navigate', 'back', 'forward', 'reload', 'close', 'focus', 'snapshot', 'frames', 'click',
  'fill', 'type', 'key', 'scroll', 'select', 'check', 'drag', 'screenshot', 'wait',
]);
const OPERATIONS = new Set(['status', 'tabs', 'open', 'workers', 'console_logs', ...TAB_OPERATIONS]);
const MAX_TEXT_LENGTH = 20000;
const MAX_CONSOLE_ENTRIES = 200;
const MAX_CONSOLE_FILTER_LENGTH = 500;

export function website(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的网址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('只能访问普通网页，不能操作浏览器设置或带有账号密码的网址。');
  }
  return url;
}

function finite(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function text(value, maximum = MAX_TEXT_LENGTH, allowEmpty = true) {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.length > 0);
}

export function validate(request) {
  const { operation, args = {} } = request ?? {};
  if (!OPERATIONS.has(operation) || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('浏览器请求无效。');
  }
  if (TAB_OPERATIONS.has(operation) && (!Number.isSafeInteger(args.tabId) || args.tabId < 0)) {
    throw new Error('请先选择浏览器标签页。');
  }
  if (['open', 'navigate'].includes(operation)) website(args.url);
  if (operation === 'open' && args.background !== undefined && typeof args.background !== 'boolean') {
    throw new Error('标签页打开方式无效。');
  }
  if (args.frameId !== undefined && !text(args.frameId, 100, false)) throw new Error('页面框架无效。');
  if (['fill', 'type'].includes(operation) && !text(args.text)) throw new Error('输入内容过长或无效。');
  if (['fill', 'type', 'select', 'check'].includes(operation) && !text(args.ref, 100, false)) {
    throw new Error('请先读取页面，再选择要操作的内容。');
  }
  if (operation === 'select' && !text(args.value)) throw new Error('选项无效。');
  if (operation === 'check' && typeof args.checked !== 'boolean') throw new Error('勾选状态无效。');
  if (operation === 'click') validateClick(args);
  if (operation === 'scroll') validateScroll(args);
  if (operation === 'console_logs') validateConsoleLogs(args);
  if (operation === 'key' && !text(args.key, 60, false)) throw new Error('按键无效。');
  if (operation === 'wait' && (!text(args.text, 500, false)
    || (args.timeoutMs !== undefined && !finite(args.timeoutMs, 100, 20000)))) {
    throw new Error('等待条件无效。');
  }
  if (operation === 'drag' && (!text(args.fromRef, 100, false) || !text(args.toRef, 100, false))) {
    throw new Error('请先读取页面，再选择拖动位置。');
  }
  return { operation, args };
}

function validateConsoleLogs(args) {
  validateLogTarget(args);
  if (args.source !== undefined && !['all', 'page', 'network', 'worker', 'browser'].includes(args.source)) {
    throw new Error('请选择有效的日志来源。');
  }
  if (args.level !== undefined && !['all', 'debug', 'log', 'info', 'warn', 'error'].includes(args.level)) {
    throw new Error('请选择有效的日志级别。');
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || !finite(args.limit, 1, MAX_CONSOLE_ENTRIES))) {
    throw new Error('日志条数应为 1 到 200 的整数。');
  }
  if (args.since !== undefined && !finite(args.since, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('请选择有效的日志起始时间。');
  }
  if (args.text !== undefined && !text(args.text, MAX_CONSOLE_FILTER_LENGTH, false)) {
    throw new Error('请输入 1 到 500 个字符作为日志关键词。');
  }
}

function validateLogTarget(args) {
  if (args.workerId !== undefined) {
    if (!text(args.workerId, 100, false) || args.tabId !== undefined || args.frameId !== undefined) {
      throw new Error('请选择一个标签页或 Worker。');
    }
    if (args.source === 'page') throw new Error('Worker 不包含页面日志，请选择其他日志来源。');
    return;
  }
  if (!Number.isSafeInteger(args.tabId) || args.tabId < 0) throw new Error('请先选择浏览器标签页。');
}

function validateClick(args) {
  if (args.doubleClick !== undefined && typeof args.doubleClick !== 'boolean') throw new Error('点击方式无效。');
  const reference = text(args.ref, 100, false);
  if (!reference && (!finite(args.x, 0, 50000) || !finite(args.y, 0, 50000))) {
    throw new Error('点击位置无效，请重新读取页面或截图。');
  }
  if (args.button !== undefined && !['left', 'right', 'middle'].includes(args.button)) {
    throw new Error('鼠标按键无效。');
  }
}

function validateScroll(args) {
  if (!finite(args.deltaY, -10000, 10000) || !finite(args.deltaX ?? 0, -10000, 10000)) {
    throw new Error('滚动距离无效。');
  }
  for (const key of ['x', 'y']) {
    if (args[key] !== undefined && !finite(args[key], 0, 50000)) throw new Error('滚动位置无效。');
  }
}
