import { Select, Tooltip } from "antd";
import type { Translate } from "../i18n";
import type { Account } from "../types";

interface ImageAccountSelectProps {
  accounts: Account[];
  accountId: string | null | undefined;
  busy: boolean;
  onChange: (accountId: string) => void;
  privacyMode?: boolean;
  t: Translate;
}

function accountLabel(account: Account, privacyMode: boolean) {
  if (!privacyMode) return account.email;
  if (account.email.length <= 10) return "*****";
  return `${account.email.slice(0, 5)}*****${account.email.slice(-5)}`;
}

export function ImageAccountSelect({
  accounts,
  accountId,
  busy,
  onChange,
  privacyMode = false,
  t,
}: ImageAccountSelectProps) {
  const imageAccounts = accounts.filter((account) => !account.agentIdentity);
  const options = imageAccounts.map((account) => ({
    label: accountLabel(account, privacyMode),
    value: account.id,
  }));
  const selectedOption = options.find((option) => option.value === accountId);

  return (
    <Tooltip title={t("providers.proxy.imageAccountTooltip")} styles={{ root: { maxWidth: 400 } }}>
      <Select
        className="proxy-image-account"
        size="small"
        aria-label={t("providers.proxy.imageAccount")}
        labelInValue
        value={selectedOption}
        options={options}
        placeholder={t(imageAccounts.length
          ? "providers.proxy.imageAccountPlaceholder"
          : "providers.proxy.imageAccountEmpty")}
        disabled={busy || imageAccounts.length === 0}
        showSearch
        optionFilterProp="label"
        onChange={(option) => onChange(option.value)}
      />
    </Tooltip>
  );
}
