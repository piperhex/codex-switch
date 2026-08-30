import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import { AccountPrivacyToggle } from "./AccountTableParts";

const t = ((key: string) => key) as Translate;

describe("AccountPrivacyToggle", () => {
  it("renders an accessible control that reflects the current privacy state", () => {
    const markup = renderToStaticMarkup(
      <AccountPrivacyToggle enabled t={t} loading={false} onChange={() => undefined} />,
    );

    expect(markup).toContain('aria-label="table.showAccountDetails"');
    expect(markup).toContain('title="table.showAccountDetails"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
