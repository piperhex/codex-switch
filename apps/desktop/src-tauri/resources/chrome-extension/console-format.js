const MAX_TEXT = 4000;
const MAX_URL = 1000;
const MAX_ARGUMENTS = 50;
const MAX_STACK_FRAMES = 8;
const MAX_FUNCTION_NAME = 200;

function clipped(value, limit, state) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  state.truncated = true;
  return text.slice(0, limit) + '…';
}

function remoteValue(value, state) {
  if (Object.hasOwn(value, 'value')) {
    return clipped(typeof value.value === 'string' ? value.value : JSON.stringify(value.value), MAX_TEXT, state);
  }
  // Use Chrome's descriptions; never invoke page getters or custom object formatters.
  return clipped(value.unserializableValue ?? value.description ?? value.type, MAX_TEXT, state);
}

function location(frame, state) {
  return {
    url: clipped(frame.url, MAX_URL, state),
    ...(Number.isInteger(frame.lineNumber) ? { line: frame.lineNumber + 1 } : {}),
    ...(Number.isInteger(frame.columnNumber) ? { column: frame.columnNumber + 1 } : {}),
  };
}

function consoleLevel(type) {
  if (type === 'warning') return 'warn';
  if (type === 'assert') return 'error';
  return ['debug', 'info', 'error'].includes(type) ? type : 'log';
}

function messageText(args, state) {
  if (args.length > MAX_ARGUMENTS) state.truncated = true;
  return clipped(args.slice(0, MAX_ARGUMENTS).map(value => remoteValue(value, state)).join(' '), MAX_TEXT, state);
}

function stackFrames(trace, state) {
  const frames = trace?.callFrames ?? [];
  if (frames.length > MAX_STACK_FRAMES || trace?.parent || trace?.parentId) {
    state.truncated = true;
  }
  return frames.slice(0, MAX_STACK_FRAMES).map(frame => ({ ...location(frame, state),
    functionName: clipped(frame.functionName, MAX_FUNCTION_NAME, state) }));
}

export function consoleEntry(method, params) {
  const exception = method === 'Runtime.exceptionThrown';
  if (!exception && method !== 'Runtime.consoleAPICalled') return null;
  const state = { truncated: false };
  const details = exception ? params.exceptionDetails : params;
  const args = exception ? [details.exception ?? { value: details.text }] : (params.args ?? []);
  const text = messageText(args, state);
  const stack = stackFrames(details.stackTrace, state);
  const source = stack.length ? stack[0] : location(details, state);
  return { level: exception ? 'error' : consoleLevel(params.type),
    type: exception ? 'exception' : params.type, text, timestamp: params.timestamp,
    url: source.url, line: source.line, column: source.column, stack, truncated: state.truncated };
}
