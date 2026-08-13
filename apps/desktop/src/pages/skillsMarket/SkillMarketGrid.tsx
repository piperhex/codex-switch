import { Download, Edit3, PackageOpen } from "lucide-react";
import { skillPreviewUrl } from "../../api/backend";
import type { SkillMarketItem } from "../../types";
import { SkillInstallButton } from "./SkillInstallButton";
import type { SkillMarketGridProps } from "./types";

function SkillCardPreview({ options, skill }: { options: SkillMarketGridProps; skill: SkillMarketItem }) {
  const { baseUrl, brokenPreviews, onPreviewError, t } = options;
  const preview = skillPreviewUrl(baseUrl, skill);
  return (
    <div className="skill-card-preview">
      {preview && !brokenPreviews.has(skill.id) ? (
        <img src={preview} alt="" onError={() => onPreviewError(skill.id)} />
      ) : (
        <div className="skill-card-default-preview"><PackageOpen size={34} /><span>SKILL</span></div>
      )}
      {skill.official && <span className="skill-official-badge">{t("skills.official")}</span>}
      <span className="skill-version">v{skill.version}</span>
    </div>
  );
}

function SkillCardBody({ options, skill }: { options: SkillMarketGridProps; skill: SkillMarketItem }) {
  const { authenticated, busySkillId, currentUserId, onEdit, onInstall, t } = options;
  const isPublisher = Boolean(authenticated && currentUserId && skill.uploaderId === currentUserId);
  return (
    <div className="skill-card-body">
      <div className="skill-card-title">
        <h3>{skill.title}</h3>
        {isPublisher && (
          <button type="button" aria-label={t("skills.edit")} onClick={() => onEdit(skill)}>
            <Edit3 size={15} />
          </button>
        )}
      </div>
      <p>{skill.description}</p>
      <div className="skill-card-meta">
        <span>{t("skills.publisher")}</span>
        <span
          aria-label={t("skills.downloads", { count: skill.installCount })}
          title={t("skills.downloads", { count: skill.installCount })}
        >
          <Download size={13} />{skill.installCount.toLocaleString()}
        </span>
      </div>
      <SkillInstallButton
        busy={busySkillId === skill.id}
        onInstall={onInstall}
        skill={skill}
        t={t}
      />
    </div>
  );
}

function SkillCard({ options, skill }: { options: SkillMarketGridProps; skill: SkillMarketItem }) {
  const { onOpen } = options;
  return (
    <article className="skill-card">
      <button
        type="button"
        className="skill-card-open"
        aria-label={skill.title}
        onClick={() => onOpen(skill.id)}
      />
      <SkillCardPreview options={options} skill={skill} />
      <SkillCardBody options={options} skill={skill} />
    </article>
  );
}

export function SkillMarketGrid(props: SkillMarketGridProps) {
  return (
    <div className="skills-market-grid">
      {props.items.map((skill) => <SkillCard key={skill.id} options={props} skill={skill} />)}
    </div>
  );
}
