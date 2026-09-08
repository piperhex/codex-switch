import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSkillMarket, installMarketSkill, removeMarketSkill, setMarketSkillEnabled,
} from "../../../api/backend";
import type { SkillMarketItem } from "../../../types";
import type { CommunitySkillBusyAction, CommunitySkillsMarketProps } from "../types";

interface Options extends Pick<CommunitySkillsMarketProps, "notify" | "t"> {
  homeId?: string;
}

export function useCommunitySkills({ homeId, notify, t }: Options) {
  const [items, setItems] = useState<SkillMarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<CommunitySkillBusyAction | null>(null);
  const mounted = useRef(true);
  const loadingRef = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const skills = await fetchSkillMarket(homeId);
      if (mounted.current) setItems(skills);
    } catch (caught) {
      if (mounted.current) setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [homeId]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (action: CommunitySkillBusyAction, operation: () => Promise<void>, message: string) => {
    if (busy.current || loadingRef.current) return;
    busy.current = true;
    setBusyAction(action);
    setError(null);
    try {
      await operation();
      if (!mounted.current) return;
      notify(message);
      await load();
    } catch (caught) {
      if (mounted.current) setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      busy.current = false;
      if (mounted.current) setBusyAction(null);
    }
  };

  const install = (skill: SkillMarketItem) => runAction(
    { action: "install", skillId: skill.id },
    () => installMarketSkill(skill, homeId),
    t(skill.installedVersion ? "skills.toast.updated" : "skills.toast.installed"),
  );
  const setEnabled = (skill: SkillMarketItem, enabled: boolean) => runAction(
    { action: "toggle", skillId: skill.id },
    () => setMarketSkillEnabled(skill.id, enabled, homeId),
    t(enabled ? "skills.toast.enabled" : "skills.toast.disabled", { name: skill.title }),
  );
  const remove = (skill: SkillMarketItem) => runAction(
    { action: "remove", skillId: skill.id },
    () => removeMarketSkill(skill.id, homeId),
    t("skills.toast.deleted", { name: skill.title }),
  );

  return { items, loading, error, busyAction, load, install, setEnabled, remove };
}
