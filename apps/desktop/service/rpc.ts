import { createInterface } from 'node:readline';

let serial = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> }>();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (line.length > 1024 * 1024) process.exit(1);
  let response: { id: number; data?: unknown; error?: string };
  try { response = JSON.parse(line) as typeof response; } catch { process.exit(1); }
  const request = pending.get(response.id);
  if (!request) return;
  clearTimeout(request.timer); pending.delete(response.id);
  if (response.error) request.reject(new Error(response.error)); else request.resolve(response.data);
});
input.on('close', () => process.exit(0));

/** Only the service's fixed native command allowlist is reachable through this inherited pipe. */
export function invoke<T>(command: string, args: object = {}): Promise<T> {
  if (pending.size >= 64) return Promise.reject(new Error('电脑正在处理其他操作，请稍后重试。'));
  const id = ++serial;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('电脑响应超时，请重试。')); }, 30_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    process.stdout.write(JSON.stringify({ id, command, args }) + '\n');
  });
}
