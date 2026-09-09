import { expect, it } from "vitest";
import { resolveModelSelection } from "./modelSelection";
import type { Model } from "./types";

const model: Model = { id: "kimi-k3", model: "kimi-k3", displayName: "Kimi K3", isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: ["low", "high", "max"].map((reasoningEffort) =>
    ({ reasoningEffort, description: "" })) };

it("resolves an implicit choice to the default model even when it is not first", () => {
  const other = { ...model, id: "other", model: "other", isDefault: false };
  expect(resolveModelSelection([other, model], { model: "", effort: "" }))
    .toEqual({ model: "kimi-k3", effort: "high" });
});

it("preserves an explicitly selected supported effort and replaces an unsupported one", () => {
  expect(resolveModelSelection([model], { model: "kimi-k3", effort: "max" }))
    .toEqual({ model: "kimi-k3", effort: "max" });
  expect(resolveModelSelection([model], { model: "kimi-k3", effort: "ultra" }))
    .toEqual({ model: "kimi-k3", effort: "high" });
});

it("uses the new model's recommended effort when the previous model is unavailable", () => {
  expect(resolveModelSelection([model], { model: "other", effort: "max" }))
    .toEqual({ model: "kimi-k3", effort: "high" });
});

it("handles a model without reasoning and an unavailable catalog without inventing a model", () => {
  expect(resolveModelSelection([{ ...model, defaultReasoningEffort: "none", supportedReasoningEfforts: [] }],
    { model: "", effort: "" })).toEqual({ model: "kimi-k3", effort: "none" });
  expect(resolveModelSelection([], { model: "", effort: "" })).toEqual({ model: "", effort: "" });
});
