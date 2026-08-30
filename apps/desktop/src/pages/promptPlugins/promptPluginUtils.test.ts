import { describe, expect, it } from "vitest";
import { isPromptPluginUpdateAvailable, nextPromptPluginVersion } from "./promptPluginUtils";

describe("prompt plugin market helpers", () => {
  it("detects an update only when the installed version differs from the market version", () => {
    expect(isPromptPluginUpdateAvailable("1.0.0", "1.1.0")).toBe(true);
    expect(isPromptPluginUpdateAvailable("1.1.0", "1.1.0")).toBe(false);
    expect(isPromptPluginUpdateAvailable(null, "1.1.0")).toBe(false);
  });

  it("increments the patch version when opening an existing prompt for editing", () => {
    expect(nextPromptPluginVersion("1.2.3")).toBe("1.2.4");
    expect(nextPromptPluginVersion("v2.0.9")).toBe("2.0.10");
    expect(nextPromptPluginVersion("preview")).toBe("preview");
  });
});
