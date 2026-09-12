import { GUI_CODEX_HOME_ID } from "../../types";
import { SkillsMarketPage } from "../SkillsMarketPage";
import type { SkillsMarketPageProps } from "../skillsMarket/types";
import styles from "./GuiPluginsPage.module.less";

export default function GuiPluginsPage(props: SkillsMarketPageProps) {
  return <section className={styles.page} aria-label={props.t("topbar.skills")}>
    <div className={styles.content}>
      <h1>{props.t("topbar.skills")}</h1>
      <SkillsMarketPage {...props} embedded homeId={GUI_CODEX_HOME_ID} />
    </div>
  </section>;
}
