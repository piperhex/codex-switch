import { useMemo } from "react";
import { TotpManager } from "../../components/TotpManager";
import type { useTotpEntries } from "../../hooks/useTotpEntries";
import type { Translate } from "../../i18n";
import type { Account } from "../../types";
import { toBoundTotpEntries } from "./boundEntries";
import styles from "./index.module.less";

interface TotpPageProps {
  accounts: Account[];
  manager: ReturnType<typeof useTotpEntries>;
  t: Translate;
}

export function TotpPage({ accounts, manager, t }: TotpPageProps) {
  const boundEntries = useMemo(() => toBoundTotpEntries(accounts), [accounts]);
  return <section className={styles.page} aria-label={t("totp.title")}>
    <TotpManager boundEntries={boundEntries} manager={manager} t={t} />
  </section>;
}
