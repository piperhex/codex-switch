import { guiText } from "../../i18n/guiText";
import { useEffect, useRef } from "react";
import { MessageSquare, Target } from "lucide-react";
import { ComposerSkillIcon } from "./ComposerSkillIcon";
import type { ComposerOption } from "./composerOptions";
import styles from "./SkillInput.module.less";

export function SkillMenu({ id, options, selected, loading, error, onChoose, below, skillsOnly, conversations }: {
  id: string; options: ComposerOption[]; selected: number; loading: boolean; error: string;
  onChoose: (option: ComposerOption) => void;
  below?: boolean; skillsOnly?: boolean; conversations?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return <div className={`${styles.menu} ${below ? styles.menuBelow : ""}`}
    onMouseDown={(event) => event.preventDefault()}>
    <div className={styles.menuHeading}>{conversations ? guiText("引用对话 · 发送时带上近期内容")
      : skillsOnly ? guiText("选择技能") : guiText("选择命令或技能")}</div>
    <div ref={list} id={id} role="listbox" aria-label={conversations ? guiText("对话") : skillsOnly ? guiText("技能") : guiText("命令和技能")}
      className={styles.options}>
      {options.map((option, index) => <button type="button" role="option" id={`${id}-${index}`}
        key={`${option.kind}-${option.key}`} tabIndex={-1}
        aria-selected={selected === index} aria-disabled={!option.enabled}
        onClick={() => option.enabled && onChoose(option)}>
        {option.kind === "skill" ? <ComposerSkillIcon skill={option.skill} />
          : option.kind === "conversation" ? <MessageSquare size={18} aria-hidden="true" />
          : option.kind === "goal" ? <Target size={18} aria-hidden="true" />
          : <svg width="18" height="18" viewBox="0 0 16 16"
          fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity=".25" />
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" pathLength="100"
            strokeDasharray={`${option.command.percent ?? 0} 100`} transform="rotate(-90 8 8)" />
        </svg>}
        <span><strong>{option.label}{option.kind === "skill" && !option.enabled && guiText("（已停用）")}</strong>
          <small>{option.description}</small></span>
      </button>)}
    </div>
    {loading && <p role="status">{conversations ? guiText("正在加载对话…") : guiText("正在加载技能…")}</p>}
    {error && <p role="status">{error}</p>}
    {!loading && !error && !options.length && <p role="status">
      {conversations ? guiText("没有找到其他对话，试试输入对话名称") : skillsOnly
        ? guiText("没有找到匹配的技能") : guiText("没有找到匹配的命令或技能")}</p>}
  </div>;
}
