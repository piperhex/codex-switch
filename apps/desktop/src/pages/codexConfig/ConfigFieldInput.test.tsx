// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigFieldInput } from "./ConfigFieldInput";

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

async function mount(fieldKey: string, value: string) {
  const onCommit = vi.fn().mockResolvedValue(true);
  await act(async () => root.render(<ConfigFieldInput schema={{ type: "string" }}
    fieldKey={fieldKey} label={fieldKey} value={value} onCommit={onCommit} />));
  const input = container.querySelector<HTMLInputElement>("input[role=combobox]");
  if (!input) throw new Error("Expected an editable model selection");
  await act(async () => {
    input.focus();
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  return { input, onCommit };
}

async function typeValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    nativeValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function optionValues() {
  return [...document.querySelectorAll(".ant-select-item-option")].map((option) => option.getAttribute("title"));
}

describe.each([
  { fieldKey: "model", selected: "gpt-6-astra", custom: "my-custom-model", initial: "gpt-5.6-sol" },
  { fieldKey: "model_provider", selected: "openai", custom: "my-provider", initial: "codex-switch-local" },
])("editable $fieldKey selection", ({ fieldKey, selected, custom, initial }) => {
  it("shows presets with an existing value and saves a selection only once", async () => {
    const { input, onCommit } = await mount(fieldKey, initial);
    expect(optionValues()).toContain(selected);
    expect(onCommit).not.toHaveBeenCalled();
    const option = document.querySelector<HTMLElement>(`.ant-select-item-option[title="${selected}"]`);
    if (!option) throw new Error("Expected a preset option");
    await act(async () => option.click());
    await act(async () => input.blur());
    await vi.waitFor(() => expect(onCommit.mock.calls).toEqual([[selected]]));
    expect(input.value).toBe(selected);
  });

  it("filters presets without saving partial input and accepts a custom value on blur", async () => {
    const { input, onCommit } = await mount(fieldKey, initial);
    await typeValue(input, selected.toUpperCase());
    expect(optionValues()).toEqual([selected]);
    expect(onCommit).not.toHaveBeenCalled();
    await typeValue(input, custom);
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => input.blur());
    await vi.waitFor(() => expect(onCommit.mock.calls).toEqual([[custom]]));
    expect(input.value).toBe(custom);
  });

  it("keeps a saved custom value and shows presets again when reopened", async () => {
    const { input, onCommit } = await mount(fieldKey, custom);
    expect(input.value).toBe(custom);
    expect(optionValues()).toContain(selected);
    await typeValue(input, "no-preset-matches");
    await act(async () => input.blur());
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    await act(async () => {
      input.focus();
      input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(optionValues()).toContain(selected);
    expect(input.value).toBe("no-preset-matches");
  });
});
