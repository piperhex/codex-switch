import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Translate } from "../../i18n";
import { AccountImageModelButton } from "./AccountImageModelButton";

const labels: Record<string, string> = {
  "providers.proxy.customImageModel": "自定义图片模型",
  "providers.proxy.customImageModelConfigured": "已配置自定义图片模型",
};
const t = ((key: string) => labels[key] ?? key) as Translate;

function renderButton(inputTarget: Parameters<typeof AccountImageModelButton>[0]["inputTarget"],
  outputTarget: Parameters<typeof AccountImageModelButton>[0]["outputTarget"]) {
  return renderToStaticMarkup(
    <AccountImageModelButton accounts={[]} providers={[]} inputTarget={inputTarget}
      outputTarget={outputTarget} busy={false} onChange={vi.fn()} privacyMode={false} t={t} />,
  );
}

describe("AccountImageModelButton", () => {
  it("shows the default label without the active style when no route is customized", () => {
    const markup = renderButton(null, null);

    expect(markup).toContain("自定义图片模型");
    expect(markup).not.toContain("proxy-topbar-action active");
  });

  it("shows the configured label and active style when either route is customized", () => {
    const outputTarget = { kind: "official" as const, accountId: "official-1" };
    const markup = renderButton(null, outputTarget);

    expect(markup).toContain("已配置自定义图片模型");
    expect(markup).toContain("proxy-topbar-action active");
  });
});
