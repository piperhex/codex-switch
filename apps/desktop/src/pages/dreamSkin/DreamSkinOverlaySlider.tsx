import { useEffect, useState } from "react";
import { Slider } from "antd";
import type { Translate } from "../../i18n";

const DEFAULT_OVERLAY_PERCENT = 80;

type Props = {
  disabled: boolean;
  opacity?: number | null;
  onChange: (opacity: number) => void;
  t: Translate;
};

function toPercent(opacity?: number | null) {
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) return DEFAULT_OVERLAY_PERCENT;
  return Math.round(Math.min(1, Math.max(0, opacity)) * 100);
}

export function DreamSkinOverlaySlider({ disabled, opacity, onChange, t }: Props) {
  const resolvedPercent = toPercent(opacity);
  const [percent, setPercent] = useState(resolvedPercent);

  useEffect(() => setPercent(resolvedPercent), [resolvedPercent]);

  const commitChange = (nextPercent: number) => {
    if (nextPercent === resolvedPercent) return;
    onChange(nextPercent / 100);
  };

  return <div className="dream-toolbar-overlay" title={t("dreamSkin.overlayOpacity.description")}>
    <span>{t("dreamSkin.overlayOpacity")}</span>
    <Slider aria-label={t("dreamSkin.overlayOpacity")} min={0} max={100} step={5}
      disabled={disabled} value={percent} tooltip={{ formatter: (value) => `${value ?? percent}%` }}
      onChange={setPercent} onChangeComplete={commitChange} />
    <b>{percent}%</b>
  </div>;
}
