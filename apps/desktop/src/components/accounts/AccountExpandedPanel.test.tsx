import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Account, ResetCreditsLoadState } from "../../types";
import type { Language } from "../../i18n";
import { AccountExpandedPanel } from "./AccountExpandedPanel";

const t = ((key: string, values?: Record<string, string | number>) => {
  if (key === "table.resetCreditsUpdated") return `Updated: ${values?.time ?? ""}`;
  return key;
}) as never;

function account(): Account {
  return {
    id: "official-1",
    email: "official@example.com",
    note: "Primary account",
    expiresAt: "2026-12-31",
    privateDetails: { password: "secret", phoneNumber: "+65 1234 5678", totpSecret: "JBSWY3DPEHPK3PXP" },
    plan: "Plus",
    active: false,
    autoSwitchEnabled: true,
    autoSwitchPriority: 0,
    autoSwitchThreshold: 0,
    localProxyCompatible: true,
    directSwitchCompatible: true,
    agentIdentity: false,
    official: true,
    metadataEditable: false,
    usage: {},
  };
}

describe("AccountExpandedPanel", () => {
  it("shows every account detail and the last reset-card refresh time", () => {
    const state: ResetCreditsLoadState = {
      status: "loaded",
      data: { credits: [] },
      fetchedAt: "2026-08-30T04:00:00.000Z",
    };

    const markup = renderToStaticMarkup(
      <AccountExpandedPanel account={account()} resetCredits={state} privacyMode={false}
        hideAccountNotes={false} onRefreshResetCredits={vi.fn()} language={"en" as Language} t={t} />,
    );

    expect(markup).toContain("Primary account");
    expect(markup).toContain("2026-12-31");
    expect(markup).toContain("+65 1234 5678");
    expect(markup).toContain("secret");
    expect(markup).toContain("JBSWY3DPEHPK3PXP");
    expect(markup).toContain("Updated:");
  });

  it("masks private values when privacy mode is enabled", () => {
    const markup = renderToStaticMarkup(
      <AccountExpandedPanel account={account()} resetCredits={undefined} privacyMode
        hideAccountNotes={false} onRefreshResetCredits={vi.fn()} language={"en" as Language} t={t} />,
    );

    expect(markup).not.toContain("secret");
    expect(markup).not.toContain("+65 1234 5678");
    expect(markup).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("does not imply a reset-card refresh before the user requests one", () => {
    const refresh = vi.fn();
    const markup = renderToStaticMarkup(
      <AccountExpandedPanel account={account()} resetCredits={undefined} privacyMode={false}
        hideAccountNotes={false} onRefreshResetCredits={refresh} language={"en" as Language} t={t} />,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(markup).toContain("table.resetCreditsUnknown");
    expect(markup).not.toContain("table.resetCreditsRefreshing");
  });

  it("keeps the last successful refresh time visible while refreshing", () => {
    const state = {
      status: "loading",
      fetchedAt: "2026-08-30T04:00:00.000Z",
    } satisfies ResetCreditsLoadState;
    const markup = renderToStaticMarkup(
      <AccountExpandedPanel account={account()} resetCredits={state} privacyMode={false}
        hideAccountNotes={false} onRefreshResetCredits={vi.fn()} language={"en" as Language} t={t} />,
    );

    expect(markup).toContain("Updated:");
  });
});
