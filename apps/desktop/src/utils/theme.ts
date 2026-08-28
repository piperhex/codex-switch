export const DEFAULT_THEME_COLOR = "#35ada7";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseColor(color: string) {
  const normalized = normalizeThemeColor(color);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(color: string, target: { r: number; g: number; b: number }, weight: number) {
  const source = parseColor(color);
  return toHex({
    r: source.r + (target.r - source.r) * weight,
    g: source.g + (target.g - source.g) * weight,
    b: source.b + (target.b - source.b) * weight,
  });
}

export function normalizeThemeColor(color?: string | null) {
  const value = color?.trim();
  if (!value) return DEFAULT_THEME_COLOR;
  const expanded = /^#[0-9a-f]{3}$/i.test(value)
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
  return HEX_COLOR_RE.test(expanded) ? expanded.toLowerCase() : DEFAULT_THEME_COLOR;
}

export function applyThemeColor(color: string) {
  const normalized = normalizeThemeColor(color);
  const rgb = parseColor(normalized);
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark";
  root.style.setProperty("--green", normalized);
  root.style.setProperty("--green-dark", mix(
    normalized,
    dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 },
    dark ? .3 : .24,
  ));
  root.style.setProperty("--green-soft", mix(
    normalized,
    dark ? { r: 17, g: 18, b: 20 } : { r: 255, g: 255, b: 255 },
    dark ? .8 : .88,
  ));
  root.style.setProperty("--green-selection", mix(
    normalized,
    dark ? { r: 17, g: 18, b: 20 } : { r: 255, g: 255, b: 255 },
    dark ? .66 : .82,
  ));
  root.style.setProperty("--green-selection-hover", mix(
    normalized,
    dark ? { r: 17, g: 18, b: 20 } : { r: 255, g: 255, b: 255 },
    dark ? .58 : .76,
  ));
  root.style.setProperty("--green-accent", mix(normalized, { r: 255, g: 255, b: 255 }, .18));
  root.style.setProperty("--green-highlight", mix(
    normalized,
    dark ? { r: 17, g: 18, b: 20 } : { r: 255, g: 255, b: 255 },
    dark ? .35 : .38,
  ));
  root.style.setProperty("--green-gradient-end", mix(normalized, { r: 255, g: 255, b: 255 }, .42));
  root.style.setProperty("--green-surface", mix(normalized, { r: 15, g: 16, b: 18 }, .82));
  root.style.setProperty("--green-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  return normalized;
}
