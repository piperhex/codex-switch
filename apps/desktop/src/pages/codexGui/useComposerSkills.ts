import { useEffect, useState } from "react";
import { guiApi } from "./api";
import { skillLabel } from "./skillEditorDom";
import type { Skill, SkillsResponse } from "./types";

export function useComposerSkills({ cwd, active, connected }: {
  cwd: string; active: boolean; connected: boolean;
}) {
  const [result, setResult] = useState({ cwd: "", skills: [] as Skill[], loading: false, error: "" });
  useEffect(() => {
    if (!active || !connected) return;
    let cancelled = false;
    setResult({ cwd, skills: [], loading: true, error: "" });
    void guiApi.request<SkillsResponse>({ operation: "skills", cwd: cwd || undefined }).then((response) => {
      if (cancelled) return;
      const skills = [...new Map(response.data.flatMap((entry) => entry.skills)
        .map((skill) => [skill.path, skill])).values()]
        .sort((left, right) => skillLabel(left).localeCompare(skillLabel(right)));
      const error = response.data.some((entry) => entry.errors.length)
        ? "部分技能未能加载，请重新打开菜单重试。" : "";
      setResult({ cwd, skills, loading: false, error });
    }).catch(() => {
      if (!cancelled) setResult({ cwd, skills: [], loading: false, error: "技能加载失败，请重新打开菜单重试。" });
    });
    return () => { cancelled = true; };
  }, [cwd, active, connected]);
  return result.cwd === cwd ? result : { skills: [], loading: active, error: "" };
}
