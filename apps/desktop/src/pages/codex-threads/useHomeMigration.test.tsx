// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrateCodexThreadsToHome } from "../../api/backend";
import { useHomeMigration } from "./useHomeMigration";

vi.mock("../../components/CodexHomeScope", () => ({
  useSelectedCodexHome: () => "source",
  useCodexHomes: () => [{ id: "source" }, { id: "target" }, { id: "third" }],
}));
vi.mock("../../api/backend", () => ({ migrateCodexThreadsToHome: vi.fn() }));
let root: Root;
let migration: ReturnType<typeof useHomeMigration>;
const selected = new Set(["one", "two"]);
const clearSelection = vi.fn();
const refresh = vi.fn(async () => {});
const reportError = vi.fn();
const setBusy = vi.fn();
const onMigrated = vi.fn();
function Harness() {
  migration = useHomeMigration({ selected, clearSelection, refresh, reportError, setBusy, notify: vi.fn(), onMigrated });
  return null;
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  vi.mocked(migrateCodexThreadsToHome).mockResolvedValue({
    requestedCount: 2, migratedCount: 2, skippedCount: 0, message: "Moved",
  });
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("moves captured selection from the current home to the chosen destination", async () => {
  await act(async () => migration.show());
  expect(migration.homes.map((home) => home.id)).toEqual(["target", "third"]);
  await act(async () => migration.setTargetHomeId("third"));
  await act(async () => migration.commit());
  expect(migrateCodexThreadsToHome).toHaveBeenCalledWith({
    homeId: "source", targetHomeId: "third", sessionIds: ["one", "two"],
  });
  expect(clearSelection).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(migration.open).toBe(false);
  expect(onMigrated).toHaveBeenCalledExactlyOnceWith("third");
});

it("refreshes partial failure while retaining the dialog and selection", async () => {
  vi.mocked(migrateCodexThreadsToHome).mockRejectedValue(new Error("failed"));
  await act(async () => migration.show());
  await act(async () => migration.commit());
  expect(reportError).toHaveBeenCalledOnce();
  expect(clearSelection).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(migration.open).toBe(true);
  expect(migration.error).toBe("failed");
  expect(setBusy).toHaveBeenLastCalledWith(false);
  expect(onMigrated).not.toHaveBeenCalled();
});

it("ignores a second click while migration is in flight", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(migrateCodexThreadsToHome).mockImplementation(() => new Promise((resolve) => {
    finish = () => resolve({ requestedCount: 2, migratedCount: 2, skippedCount: 0, message: "Moved" });
  }));
  await act(async () => migration.show());
  await act(async () => {
    const first = migration.commit();
    await migration.commit();
    expect(migrateCodexThreadsToHome).toHaveBeenCalledOnce();
    finish?.();
    await first;
  });
});
