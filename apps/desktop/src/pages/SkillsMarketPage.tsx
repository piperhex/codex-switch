import { useState } from "react";
import { CommunitySkillsMarket } from "./skillsMarket/CommunitySkillsMarket";
import { OfficialPluginsMarket } from "./skillsMarket/OfficialPluginsMarket";
import type { SkillsMarketPageProps, SkillsMarketTab } from "./skillsMarket/types";

export function SkillsMarketPage(props: SkillsMarketPageProps) {
  const [activeTab, setActiveTab] = useState<SkillsMarketTab>("community");
  const navigation = { activeTab, onTabChange: setActiveTab };

  if (activeTab === "official") {
    return <OfficialPluginsMarket {...navigation} active={props.active} notify={props.notify} t={props.t} />;
  }

  return <CommunitySkillsMarket {...props} {...navigation} />;
}
