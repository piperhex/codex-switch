import { beforeEach, expect, it, vi } from "vitest";
import { terminalApi, type TerminalEvent, type TerminalInfo } from "./api";
import { connectTerminal } from "./connection";

vi.mock("./api", () => ({ terminalApi: { open: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() } }));
const info = { id: "session", cwd: "D:/project", shell: "PowerShell" };
const options = () => ({ cwd: info.cwd, size: { cols: 80, rows: 24 },
  onEvent: vi.fn(), onReady: vi.fn(), onError: vi.fn() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(terminalApi.open).mockResolvedValue(info);
  vi.mocked(terminalApi.write).mockResolvedValue();
  vi.mocked(terminalApi.resize).mockResolvedValue();
  vi.mocked(terminalApi.close).mockResolvedValue();
});

it("buffers early cursor replies and preserves input order while a shell write is blocked", async () => {
  const opening = deferred<TerminalInfo>();
  const writing = deferred<void>();
  vi.mocked(terminalApi.open).mockReturnValue(opening.promise);
  vi.mocked(terminalApi.write).mockReturnValueOnce(writing.promise);
  const connection = connectTerminal(options());
  connection.input("\x1b[1;1R");
  expect(terminalApi.write).not.toHaveBeenCalled();
  opening.resolve(info); await flush();
  connection.input("echo 中文\r"); connection.input("next\r");
  expect(terminalApi.write).toHaveBeenCalledTimes(1);
  writing.resolve(); await flush();
  expect(vi.mocked(terminalApi.write).mock.calls.map((call) => call[1])).toEqual(["\x1b[1;1R", "echo 中文\rnext\r"]);
  connection.dispose();
});

it("coalesces resizing and closes immediately even while input is blocked", async () => {
  const pending = deferred<void>();
  vi.mocked(terminalApi.write).mockReturnValue(pending.promise);
  vi.mocked(terminalApi.resize).mockReturnValueOnce(pending.promise);
  const connection = connectTerminal(options()); await flush();
  connection.input("busy");
  connection.resize({ cols: 100, rows: 30 });
  connection.resize({ cols: 120, rows: 40 });
  connection.resize({ cols: 140, rows: 50 });
  expect(terminalApi.resize).toHaveBeenCalledTimes(1);
  pending.resolve(); await flush();
  expect(terminalApi.resize).toHaveBeenLastCalledWith(info.id, { cols: 140, rows: 50 });
  connection.dispose();
  expect(terminalApi.close).toHaveBeenCalledWith(info.id);
});

it("cleans up a session that finishes opening after its tab has unmounted", async () => {
  const opening = deferred<TerminalInfo>();
  vi.mocked(terminalApi.open).mockReturnValue(opening.promise);
  const callbacks = options();
  const connection = connectTerminal(callbacks);
  connection.dispose(); opening.resolve(info); await flush();
  expect(terminalApi.close).toHaveBeenCalledOnce();
  expect(callbacks.onReady).not.toHaveBeenCalled();
});

it("stops sending after shell exit and forwards raw bytes without corrupting Unicode", async () => {
  let receive!: (event: TerminalEvent) => void;
  vi.mocked(terminalApi.open).mockImplementation(async (_cwd, _size, onEvent) => { receive = onEvent; return info; });
  const callbacks = options();
  const connection = connectTerminal(callbacks); await flush();
  const first: TerminalEvent = { type: "output", data: [0xe4, 0xb8] };
  receive(first); receive({ type: "output", data: [0xad] }); receive({ type: "exit", code: 0 });
  connection.input("late");
  expect(terminalApi.write).not.toHaveBeenCalled();
  expect(callbacks.onEvent).toHaveBeenCalledWith(first);
  connection.dispose();
});

it("limits pasted input without splitting emoji at a write boundary", async () => {
  const callbacks = options();
  const connection = connectTerminal(callbacks); await flush();
  connection.input("x".repeat(256 * 1024 + 1));
  expect(callbacks.onError).toHaveBeenCalled();
  expect(terminalApi.write).not.toHaveBeenCalled();
  connection.input("x".repeat(4095) + "😀尾"); await flush();
  const data = vi.mocked(terminalApi.write).mock.calls.map((call) => call[1]);
  expect(data).toEqual(["x".repeat(4095) + "😀", "尾"]);
  connection.dispose();
});
