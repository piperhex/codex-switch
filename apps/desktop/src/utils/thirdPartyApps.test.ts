import { describe, expect, it } from "vitest";
import {
  normalizeThirdPartyAppWriteSettings,
  settingsFromLegacyTarget,
} from "./thirdPartyApps";

describe("third-party app write settings", () => {
  it("migrates every legacy Claude Code write target", () => {
    expect(settingsFromLegacyTarget("codex")).toMatchObject({
      enabled: false,
      writeCodex: true,
      apps: { claudeCode: false },
    });
    expect(settingsFromLegacyTarget("claudeCode")).toMatchObject({
      enabled: true,
      writeCodex: false,
      apps: { claudeCode: true },
    });
    expect(settingsFromLegacyTarget("all")).toMatchObject({
      enabled: true,
      writeCodex: true,
      apps: { claudeCode: true },
    });
  });

  it("fills missing app choices without changing saved values", () => {
    const settings = normalizeThirdPartyAppWriteSettings({
      enabled: true,
      writeCodex: false,
      apps: { openCode: true, openClaw: true },
    });

    expect(settings.apps.openCode).toBe(true);
    expect(settings.apps.openClaw).toBe(true);
    expect(settings.apps.claudeCode).toBe(false);
    expect(settings.apps.openViking).toBe(false);
  });
});
