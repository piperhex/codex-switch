import { ComposerSkillIcon } from "./ComposerSkillIcon";
import { skillDescription, skillLabel } from "./skillEditorDom";
import type { Skill } from "./types";
import styles from "./ComposerAddMenu.module.less";

export function ComposerSkillSection({ catalog, onChoose }: {
  catalog: { skills: Skill[]; loading: boolean; error: string }; onChoose: (skill: Skill) => void;
}) {
  return <>
    <div className={styles.heading}>技能</div>
    {catalog.skills.map((skill) => <button type="button" role="menuitem" key={skill.path}
      disabled={!skill.enabled} className={styles.option} onClick={() => onChoose(skill)}>
      <ComposerSkillIcon skill={skill} size={19} />
      <span>{skillLabel(skill)}{!skill.enabled && "（已停用）"}<small>{skillDescription(skill)}</small></span>
    </button>)}
    {catalog.loading && <p role="status" className={styles.empty}>正在加载技能…</p>}
    {catalog.error && <p role="status" className={styles.empty}>{catalog.error}</p>}
    {!catalog.loading && !catalog.error && !catalog.skills.length
      && <p className={styles.empty}>暂无可用技能。</p>}
  </>;
}
