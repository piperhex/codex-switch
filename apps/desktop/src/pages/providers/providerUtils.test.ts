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
    ["deepseek-v4-flash-vision-exp", ["none", "low", "high", "max"]],
    ["doubao-seed-2-0-code-preview-260215", ["none", "low", "medium", "high"]],
    ["gpt-oss:20b", ["low", "medium", "high"]],
    ["gpt-5.4-mini", ["none", "low", "medium", "high", "xhigh"]],
    ["GPT-5.6-SOL", ["none", "low", "medium", "high", "xhigh", "max"]],
  ])("assigns distinct reasoning modes to %s", (model, expected) => {
    expect(defaultReasoningEfforts(model)).toEqual(expected);
  });

  it("accepts every bundled default without dropping unsupported values", () => {
    expect(Object.keys(modelReasoningDefaults)).toHaveLength(35);
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

  it("keeps provider-specific GPT efforts when refreshing public-model defaults", () => {
    const [custom] = modelReasoningConfigs(["gpt-5.6-sol"], {
      reasoningEfforts: { "gpt-5.6-sol": ["high", "ultra"] },
    });
    expect(custom.reasoningEfforts).toEqual(["high", "ultra"]);
    expect(defaultReasoningEfforts("gpt-5.6-sol-openai-compact")).toContain("ultra");
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
