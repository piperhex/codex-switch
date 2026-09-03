import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import { UsageSpeedPill } from "./UsageSpeedPill";

const t = ((key: string) => key) as Translate;

describe("UsageSpeedPill", () => {
  it("renders a compact accessible two-mode control", () => {
    const markup = renderToStaticMarkup(
      <UsageSpeedPill fastModeEnabled fastModeAvailable proxyRunning loading={false}
        onChange={() => undefined} t={t} />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="usage.speedMode"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("usage.speedNormal");
    expect(markup).toContain("usage.speedFast");
  });

  it("disables both modes while the proxy is stopped", () => {
    const markup = renderToStaticMarkup(
      <UsageSpeedPill fastModeEnabled={false} fastModeAvailable proxyRunning={false} loading={false}
        onChange={() => undefined} t={t} />,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("keeps normal mode available when Fast is unsupported", () => {
    const markup = renderToStaticMarkup(
      <UsageSpeedPill fastModeEnabled fastModeAvailable={false} proxyRunning loading={false}
        onChange={() => undefined} t={t} />,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(1);
  });
});
