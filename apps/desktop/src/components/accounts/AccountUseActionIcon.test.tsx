import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountUseActionIcon } from "./AccountUseActionIcon";

describe("AccountUseActionIcon", () => {
  it("renders the cancel-use icon for the active account", () => {
    const markup = renderToStaticMarkup(<AccountUseActionIcon active />);

    expect(markup).toContain("lucide-circle-off");
  });

  it("renders the enable icon for an inactive account", () => {
    const markup = renderToStaticMarkup(<AccountUseActionIcon active={false} />);

    expect(markup).toContain("lucide-power");
  });
});
