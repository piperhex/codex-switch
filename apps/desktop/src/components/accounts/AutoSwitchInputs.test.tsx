// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ACCOUNTS } from "../../demo";
import type { Translate } from "../../i18n";
import { AccountCardAutoSwitchSettings } from "./AccountCardAutoSwitchSettings";
import { AutoSwitchPriorityInput, AutoSwitchThresholdInput } from "./AccountTableParts";

const account = { ...DEMO_ACCOUNTS[0], autoSwitchPriority: 10, autoSwitchThreshold: 20 };
const t: Translate = (key) => key;
const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(element: ReactElement) {
  await act(async () => root.render(element));
}

function getInput() {
  const input = container.querySelector<HTMLInputElement>("input[role=spinbutton]");
  if (!input) throw new Error("Expected an editable numeric input");
  return input;
}

async function typeValue(text: string) {
  const input = getInput();
  await act(async () => input.focus());
  for (const value of ["", ...Array.from(text, (_, index) => text.slice(0, index + 1))]) {
    await act(async () => {
      nativeValueSetter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  return input;
}

async function finish(input: HTMLInputElement, action: "Enter" | "blur" | "Escape") {
  await act(async () => {
    if (action === "blur") input.blur();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: action, bubbles: true }));
  });
}

async function openCardEditor(kind: "priority" | "threshold", onSave = vi.fn().mockResolvedValue(true)) {
  const onSwitch = vi.fn();
  await mount(<article onClick={onSwitch}>
    <AccountCardAutoSwitchSettings account={account} t={t} priorityEnabled thresholdEnabled
      priorityBusy={false} thresholdBusy={false} onPrioritySave={onSave} onThresholdSave={onSave} />
  </article>);
  const title = kind === "priority" ? "table.autoSwitchPriority" : "table.autoSwitchThreshold";
  const button = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
  await act(async () => button.click());
  expect(document.activeElement).toBe(getInput());
  return { onSave, onSwitch };
}

describe.each(["Enter", "blur"] as const)("auto-switch inputs saved on %s", (action) => {
  it.each([
    { input: "150", expected: 100 },
    { input: "-1", expected: 0 },
    { input: "15.55", expected: 15.6 },
    { input: "", expected: 0 },
  ])("saves the normalized threshold for '$input'", async ({ input, expected }) => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onFinish = vi.fn();
    await mount(<AutoSwitchThresholdInput account={account} disabled={false} t={t}
      onSave={onSave} onFinish={onFinish} />);
    await finish(await typeValue(input), action);
    expect(onSave.mock.calls).toEqual([[account.id, expected]]);
    expect(onFinish).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(getInput());
  });

  it.each([
    { input: "2147483648", expected: 2147483647 },
    { input: "-2147483649", expected: -2147483648 },
    { input: "1.9", expected: 2 },
  ])("saves the normalized priority for '$input'", async ({ input, expected }) => {
    const onSave = vi.fn().mockResolvedValue(true);
    await mount(<AutoSwitchPriorityInput account={account} disabled={false} t={t} onSave={onSave} />);
    await finish(await typeValue(input), action);
    expect(onSave.mock.calls).toEqual([[account.id, expected]]);
  });

  it("saves the normalized card value once and closes the editor without switching accounts", async () => {
    const { onSave, onSwitch } = await openCardEditor("threshold");
    await finish(await typeValue("150"), action);
    expect(onSave.mock.calls).toEqual([[account.id, 100]]);
    expect(container.querySelector("input[role=spinbutton]")).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe("auto-switch editor completion", () => {
  it.each(["priority", "threshold"] as const)("cancels a %s edit with Escape", async (kind) => {
    const { onSave, onSwitch } = await openCardEditor(kind);
    await finish(await typeValue("25"), "Escape");
    expect(onSave).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
    expect(container.querySelector("input[role=spinbutton]")).toBeNull();
  });

  it("restores the original value after a failed save", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    await mount(<AutoSwitchThresholdInput account={account} disabled={false} t={t} onSave={onSave} />);
    await finish(await typeValue("150"), "Enter");
    expect(onSave.mock.calls).toEqual([[account.id, 100]]);
    expect(Number(getInput().value)).toBe(20);
  });

  it("closes an unchanged card edit without saving", async () => {
    const { onSave } = await openCardEditor("priority");
    await finish(getInput(), "Enter");
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector("input[role=spinbutton]")).toBeNull();
  });
});
