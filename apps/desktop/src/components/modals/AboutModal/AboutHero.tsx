import { Leaf, Monitor, Scale } from "lucide-react";
import type { Translate } from "../../../i18n";

export function AboutHero({ logoUrl, t }: { logoUrl: string; t: Translate }) {
  return <header className="about-hero">
    <span className="about-eyebrow">{t("about.eyebrow")}</span>
    <div className="about-brand">
      <div className="about-brand-mark"><img src={logoUrl} alt="" /></div>
      <div className="about-brand-copy">
        <h2 id="about-modal-title">Codex Remote</h2>
        <p>{t("about.tagline")}</p>
        <div className="about-badges" aria-label={t("about.badges")}>
          <span><Leaf aria-hidden="true" />{t("about.badge.local")}</span>
          <span><Monitor aria-hidden="true" />{t("about.badge.desktop")}</span>
          <span><Scale aria-hidden="true" />Apache-2.0</span>
        </div>
      </div>
    </div>
    <p className="about-handwritten">{t("about.freedom")}</p>
    <div className="about-hero-art" aria-hidden="true">
      <div className="about-glass about-glass-back" />
      <div className="about-glass about-glass-front" />
      <div className="about-glass about-glass-icon"><img src={logoUrl} alt="" /></div>
      <p className="about-art-words"><span>Switch</span><span>Manage</span><span>Focus</span></p>
    </div>
    <p className="about-hero-caption">{t("about.workspace")}</p>
  </header>;
}
