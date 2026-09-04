const CODEX_SPEED_SELECTOR_OVERLAY: &str = r#"
  (() => {
    const stateKey = "__CODEX_SWITCH_SPEED_SELECTOR__";
    const overlayVersion = 10;
    const usageRefreshMs = 30000;
    const initialTier = __CODEX_SWITCH_SERVICE_TIER__;
    const existing = window[stateKey];
    const removeSelectors = () => {
      existing?.observer?.disconnect();
      if (existing?.timer) clearInterval(existing.timer);
      if (existing?.usageTimer) clearInterval(existing.usageTimer);
      const injectedNodes = "[data-codex-switch-speed-selector], [data-codex-switch-speed-submenu]";
      for (const selector of document.querySelectorAll(injectedNodes)) selector.remove();
      delete window[stateKey];
    };
    if (window.__CODEX_SWITCH_SPEED_SELECTOR_ALLOWED__ !== true) {
      removeSelectors();
      return;
    }
    if (existing?.installed && existing.version === overlayVersion) {
      if (!existing.pendingTier) existing.tier = initialTier;
      existing.syncAll?.();
      existing.requestUsage?.();
      return;
    }
    removeSelectors();
    const state = {
      installed: true, version: overlayVersion, tier: initialTier, observer: null, timer: null,
      usageTimer: null, pendingTier: null, previousTier: null, syncAll: null,
      completeSelection: null, updateUsage: null, requestUsage: null,
      usage: { enabled: false, totalTokens: 0, estimatedCostUsd: 0 },
    };
    window[stateKey] = state;
    const formatTokens = value => {
      if (value >= 1000000) {
        return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value / 1000000)}M`;
      }
      if (value >= 1000) {
        return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / 1000)}K`;
      }
      return new Intl.NumberFormat("en-US").format(value);
    };
    const formatCost = value => {
      const maximumFractionDigits = value > 0 && value < 0.01 ? 4 : 2;
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)}USD`;
    };
    const usesDarkPalette = element => {
      const channels = getComputedStyle(element).color.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) return false;
      const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      return luminance > 150;
    };
    const syncUsageColors = usage => {
      const dark = usesDarkPalette(usage);
      const tokens = dark ? "rgb(84,214,177)" : "rgb(10,132,105)";
      const cost = dark ? "rgb(245,177,65)" : "rgb(180,93,0)";
      usage.querySelector("[data-today-tokens]").style.setProperty("color", tokens, "important");
      usage.querySelector("[data-today-cost]").style.setProperty("color", cost, "important");
    };
    const syncSwitch = selector => {
      const toggle = selector.querySelector("[data-speed-switch]");
      if (!toggle) return;
      const enabled = state.tier === "priority";
      toggle.setAttribute("aria-checked", String(enabled));
      toggle.style.background = enabled ? "rgb(16,163,127)" : "rgb(142,142,147)";
      toggle.firstElementChild.style.transform = enabled ? "translateX(12px)" : "translateX(0)";
    };
    const syncUsage = selector => {
      const usage = selector.querySelector("[data-today-usage]");
      if (!usage) return;
      usage.hidden = !state.usage.enabled;
      usage.style.display = usage.hidden ? "none" : "inline-flex";
      if (usage.hidden) return;
      syncUsageColors(usage);
      const tokens = formatTokens(state.usage.totalTokens);
      const cost = formatCost(state.usage.estimatedCostUsd);
      usage.querySelector("[data-today-tokens]").textContent = tokens;
      usage.querySelector("[data-today-cost]").textContent = cost;
      usage.title = `今日 Token 用量：${tokens}\n今日预估成本：${cost}`;
      usage.setAttribute("aria-label", `今日 Token 用量 ${tokens}，今日预估成本 ${cost}`);
    };
    const syncAll = () => {
      for (const selector of document.querySelectorAll("[data-codex-switch-speed-selector]")) {
        syncUsage(selector);
        syncSwitch(selector);
        const toggle = selector.querySelector("[data-speed-switch]");
        if (toggle) toggle.disabled = Boolean(state.pendingTier);
      }
    };
    state.syncAll = syncAll;
    state.updateUsage = summary => {
      const totalTokens = Number(summary?.totalTokens);
      const estimatedCostUsd = Number(summary?.estimatedCostUsd);
      state.usage = {
        enabled: summary?.enabled === true,
        totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
        estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? Math.max(0, estimatedCostUsd) : 0,
      };
      syncAll();
    };
    state.requestUsage = () => {
      if (typeof window.codexSwitchRequestUsageSummary === "function") {
        window.codexSwitchRequestUsageSummary("refresh");
      }
    };
    state.completeSelection = (tier, succeeded) => {
      if (state.pendingTier !== tier) return;
      if (!succeeded) state.tier = state.previousTier;
      state.pendingTier = null;
      state.previousTier = null;
      syncAll();
    };
    const selectTier = tier => {
      if (state.pendingTier || typeof window.codexSwitchSetServiceTier !== "function") return;
      state.previousTier = state.tier;
      state.tier = tier;
      state.pendingTier = tier;
      syncAll();
      window.codexSwitchSetServiceTier(tier);
    };
    const createUsage = () => {
      const usage = document.createElement("span");
      const today = document.createElement("span");
      const tokens = document.createElement("strong");
      const separator = document.createElement("span");
      const cost = document.createElement("strong");
      usage.dataset.todayUsage = "true";
      usage.hidden = true;
      usage.style.cssText = "display:inline-flex;align-items:baseline;gap:3px;margin-right:2px;"
        + "font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;";
      today.textContent = "今日";
      today.style.color = "var(--text-tertiary)";
      tokens.dataset.todayTokens = "true";
      tokens.style.fontWeight = "650";
      separator.textContent = "·";
      separator.style.color = "var(--text-tertiary)";
      cost.dataset.todayCost = "true";
      cost.style.fontWeight = "650";
      usage.append(today, tokens, separator, cost);
      return usage;
    };
    const createSelector = () => {
      const container = document.createElement("div");
      const content = document.createElement("div");
      const label = document.createElement("span");
      const toggle = document.createElement("button");
      const thumb = document.createElement("span");
      container.dataset.codexSwitchSpeedSelector = "true";
      container.className = "no-drag cursor-interaction select-none";
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", "快速模式");
      container.style.cssText = "display:inline-flex;align-items:center;flex:0 0 auto;width:auto;"
        + "white-space:nowrap;margin-right:4px;padding:3px 8px;border-radius:9999px;"
        + "background:var(--background-primary-ghost);font-size:14px;line-height:18px;"
        + "color:var(--text-tertiary);";
      container.style.setProperty("display", "inline-flex", "important");
      content.style.cssText = "display:flex;align-items:center;gap:6px;";
      label.className = "text-tertiary text-sm leading-[18px]";
      label.textContent = "快速模式";
      toggle.type = "button";
      toggle.dataset.speedSwitch = "true";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-label", "快速模式");
      toggle.style.cssText = "display:block;flex:0 0 auto;width:28px;height:16px;padding:2px;"
        + "appearance:none;border:0;border-radius:9999px;cursor:pointer;"
        + "background:rgb(142,142,147);transition:background 120ms ease;";
      thumb.style.cssText = "display:block;width:12px;height:12px;border-radius:50%;"
        + "background:rgb(255,255,255);transition:transform 120ms ease;";
      toggle.append(thumb);
      toggle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        selectTier(state.tier === "priority" ? "default" : "priority");
      });
      content.append(createUsage(), label, toggle);
      container.append(content);
      for (const eventName of ["pointerdown", "mousedown", "click"]) {
        container.addEventListener(eventName, event => {
          event.stopPropagation();
        }, eventName !== "click");
      }
      syncUsage(container);
      syncSwitch(container);
      return container;
    };
    const render = () => {
      if (window.__CODEX_SWITCH_SPEED_SELECTOR_ALLOWED__ !== true) {
        for (const selector of document.querySelectorAll("[data-codex-switch-speed-selector]")) selector.remove();
        return;
      }
      const anchor = document.querySelector('[data-composer-navigation-target="reasoning"]');
      if (!anchor) return;
      const modelWrapper = anchor.parentElement?.parentElement;
      const parent = modelWrapper?.parentElement;
      let container = parent?.querySelector(":scope > [data-codex-switch-speed-selector]");
      if (!container) {
        container = createSelector();
        modelWrapper.before(container);
      }
    };
    state.observer = new MutationObserver(render);
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    state.timer = setInterval(render, 1000);
    state.usageTimer = setInterval(state.requestUsage, usageRefreshMs);
    render();
    setTimeout(state.requestUsage, 0);
  })();
"#;
