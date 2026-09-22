const MAX_TEXT = 4000;
const MAX_URL = 1000;
const MAX_ARGUMENTS = 50;
const MAX_STACK_FRAMES = 8;
const MAX_STACK_DEPTH = 8;
const MAX_FUNCTION_NAME = 200;
const MAX_PREVIEW_PROPERTIES = 10;
const MAX_PREVIEW_ENTRIES = 5;
const MAX_PREVIEW_DEPTH = 2;

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
  // Chrome supplies previews with the event; never evaluate getters or custom formatters.
  if (value.preview) return clipped(objectPreview(value.preview, state), MAX_TEXT, state);
  return clipped(value.unserializableValue ?? value.description ?? value.type, MAX_TEXT, state);
}

function previewProperty(property, state, depth) {
  if (property.type === 'accessor') return '<getter>';
  if (property.valuePreview) return objectPreview(property.valuePreview, state, depth + 1);
  const value = clipped(property.value ?? property.type, MAX_TEXT, state);
  return property.type === 'string' ? JSON.stringify(value) : value;
}

function objectPreview(preview, state, depth = 0) {
  const description = clipped(preview.description ?? preview.type, MAX_TEXT, state);
  if (depth >= MAX_PREVIEW_DEPTH) { state.truncated = true; return description; }
  const properties = preview.properties ?? [];
  const entries = preview.entries ?? [];
  const omitted = preview.overflow || properties.length > MAX_PREVIEW_PROPERTIES
    || entries.length > MAX_PREVIEW_ENTRIES;
  state.truncated ||= Boolean(omitted);
  const values = properties.slice(0, MAX_PREVIEW_PROPERTIES).map(property =>
    `${clipped(property.name, MAX_FUNCTION_NAME, state)}: ${previewProperty(property, state, depth)}`);
  for (const entry of entries.slice(0, MAX_PREVIEW_ENTRIES)) {
    const value = objectPreview(entry.value, state, depth + 1);
    values.push(entry.key ? `${objectPreview(entry.key, state, depth + 1)} => ${value}` : value);
  }
  if (omitted) values.push('…');
  if (!values.length) return description;
  return clipped(`${description} {${values.join(', ')}}`, MAX_TEXT, state);
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
  const frames = [];
  let asynchronous = false;
  let depth = 0;
  // Inline async parents are already part of the event and need no extra debugger access.
  while (trace && frames.length < MAX_STACK_FRAMES && depth++ < MAX_STACK_DEPTH) {
    const remaining = MAX_STACK_FRAMES - frames.length;
    const current = trace.callFrames ?? [];
    state.truncated ||= current.length > remaining || Boolean(trace.parentId);
    frames.push(...current.slice(0, remaining).map(frame => ({ ...location(frame, state),
      functionName: clipped(frame.functionName, MAX_FUNCTION_NAME, state),
      ...(asynchronous ? { asynchronous: true,
        asyncDescription: clipped(trace.description, MAX_FUNCTION_NAME, state) } : {}) })));
    trace = trace.parent;
    asynchronous = true;
  }
  state.truncated ||= Boolean(trace);
  return frames;
}

export function consoleEntry(method, params, worker) {
  const exception = method === 'Runtime.exceptionThrown';
  if (!exception && method !== 'Runtime.consoleAPICalled') return null;
  const details = exception ? params.exceptionDetails : params;
  const args = exception ? [details.exception ?? { value: details.text }] : (params.args ?? []);
  const state = { truncated: args.some(value => value.previewUnavailable) };
  const text = messageText(args, state);
  const stack = stackFrames(details.stackTrace, state);
  const source = stack.length ? stack[0] : location(details, state);
  return { level: exception ? 'error' : consoleLevel(params.type),
    source: worker ? 'worker' : 'page', ...(worker ? workerFields(worker, state) : {}),
    type: exception ? 'exception' : params.type, text, timestamp: params.timestamp,
    ...(args.some(value => value.previewReadAt) ? { objectPreviewTiming: 'read' } : {}),
    url: source.url, line: source.line, column: source.column, stack, truncated: state.truncated };
}

function workerFields(worker, state) {
  return { workerId: clipped(worker.targetId, MAX_URL, state),
    workerUrl: clipped(worker.url, MAX_URL, state), workerType: worker.type, scope: 'worker' };
}

export function browserLogEntry(entry, worker) {
  const state = { truncated: false };
  const level = entry.level === 'verbose' ? 'debug' : consoleLevel(entry.level);
  const text = clipped(entry.text, MAX_TEXT, state);
  const stack = stackFrames(entry.stackTrace, state);
  const source = location(entry, state);
  const details = worker ? workerFields(worker, state) : { scope: 'renderer' };
  const category = ['network', 'worker'].includes(entry.source) ? entry.source : 'browser';
  return { source: category, type: entry.source, level, text, timestamp: entry.timestamp,
    ...source, ...details, stack,
    ...(entry.networkRequestId ? { requestId: clipped(entry.networkRequestId, MAX_URL, state) } : {}),
    ...(entry.workerId ? { workerId: clipped(entry.workerId, MAX_URL, state) } : {}),
    truncated: state.truncated };
}
