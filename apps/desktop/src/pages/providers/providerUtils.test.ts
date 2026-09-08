import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import modelReasoningDefaults from "../../modelReasoningDefaults.json";
import {
  defaultReasoningEfforts,
  modelReasoningConfigs,
  REASONING_EFFORTS,
  reasoningEffortOptions,
} from "./providerUtils";

const translateKey: Translate = (key) => key;

describe("provider reasoning effort defaults", () => {
  it.each<[string, string[]]>([
    ["deepseek-v4-flash-0731", ["none", "low", "high", "max"]],
    ["deepseek-v4-pro-0813", ["none", "low", "high", "max"]],
    ["glm-5.2", ["none", "high", "max"]],
    ["ZHIPU/GLM-5.3-Flash", ["low", "high", "max"]],
    ["kimi-k2.7-code", ["high"]],
    ["MiniMax-M2.7", ["high"]],
    ["qwen3.8-max", ["none", "low", "medium", "xhigh"]],
    ["seed-2.1-turbo", ["none", "low", "medium", "high"]],
  ])("assigns distinct reasoning modes to %s", (model, expected) => {
    expect(defaultReasoningEfforts(model)).toEqual(expected);
  });

  it("accepts every bundled default without dropping unsupported values", () => {
    expect(Object.keys(modelReasoningDefaults)).toHaveLength(21);
    for (const [model, efforts] of Object.entries(modelReasoningDefaults)) {
      expect(defaultReasoningEfforts(model)).toEqual(efforts);
    }
    expect(defaultReasoningEfforts("glm-5.30")).toEqual(["none", "high"]);
  });

  it("preserves explicit selections, including unfinished empty edits", () => {
    const configs = modelReasoningConfigs(["glm-5.3", "qwen3.8-max", "seed-2.1-pro"], {
      reasoningEfforts: { "glm-5.3": ["none", "ultra"], "qwen3.8-max": [] },
    });
    expect(configs[0].reasoningEfforts).toEqual(["none", "ultra"]);
    expect(configs[1].reasoningEfforts).toEqual([]);
    expect(configs[2].reasoningEfforts).toEqual(["none", "low", "medium", "high"]);
  });

  it("includes max and ultra for GPT-6 Astra", () => {
    expect(defaultReasoningEfforts("GPT-6-ASTRA")).toEqual([
      "low", "medium", "high", "xhigh", "max", "ultra",
    ]);
  });

  it("keeps every reasoning effort available for manual selection", () => {
    const options = reasoningEffortOptions(translateKey);

    expect(options.map(({ value }) => value)).toEqual(REASONING_EFFORTS);
  });

  it("defaults newly fetched Astra models to ultra while preserving explicit selections", () => {
    const [astra] = modelReasoningConfigs(["gpt-6-astra"]);
    expect(astra.reasoningEfforts).toContain("ultra");
    const [custom] = modelReasoningConfigs(["gpt-6-astra"], {
      reasoningEfforts: { "gpt-6-astra": ["high"] },
    });
    expect(custom.reasoningEfforts).toEqual(["high"]);
    expect(defaultReasoningEfforts("gpt-5.6-luna")).not.toContain("ultra");
  });
});
