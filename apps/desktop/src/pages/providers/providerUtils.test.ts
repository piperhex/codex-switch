import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import {
  defaultReasoningEfforts,
  modelReasoningConfigs,
  REASONING_EFFORTS,
  reasoningEffortOptions,
} from "./providerUtils";

const translateKey: Translate = (key) => key;

describe("provider reasoning effort defaults", () => {
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
