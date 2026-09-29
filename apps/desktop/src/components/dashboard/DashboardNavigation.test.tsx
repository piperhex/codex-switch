// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { translate, type Translate } from "../../i18n";
import { DashboardNavigation, isToolboxPage } from "./DashboardNavigation";

const t: Translate = (key, params) => translate("en", key, params);

describe("authenticator navigation", () => {
  it.each(["sidebar", "toolbox"] as const)("selects the 2FA page from the %s menu", async (variant) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    const root = createRoot(container);
    const onPageChange = vi.fn();
    const open = vi.spyOn(window, "open");
    try {
      await act(async () => root.render(
        <DashboardNavigation page="accounts" onPageChange={onPageChange} t={t} variant={variant} />,
      ));
      const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "2FA");
      expect(button).toBeDefined();
      await act(async () => button?.click());
      expect(onPageChange).toHaveBeenCalledWith("totp");
      expect(open).not.toHaveBeenCalled();
      await act(async () => root.render(
        <DashboardNavigation page="totp" onPageChange={onPageChange} t={t} variant={variant} />,
      ));
      expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("2FA");
      expect(isToolboxPage("totp")).toBe(true);
    } finally {
      await act(async () => root.unmount());
      open.mockRestore();
    }
  });
});
