import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import {
  defaultReasoningEfforts,
  REASONING_EFFORTS,
  reasoningEffortOptions,
} from "./providerUtils";

const translateKey: Translate = (key) => key;

describe("provider reasoning effort defaults", () => {
  it("includes max but not ultra for GPT-6 Astra", () => {
    expect(defaultReasoningEfforts("GPT-6-ASTRA")).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
  });

  it("keeps every reasoning effort available for manual selection", () => {
    const options = reasoningEffortOptions(translateKey);

    expect(options.map(({ value }) => value)).toEqual(REASONING_EFFORTS);
  });
});
