import { Button, Popconfirm } from "antd";
import { ArrowRight, Info, Play, SlidersHorizontal, UserRound } from "lucide-react";
import type { Translate } from "../i18n";
import "./thirdPartyAppsSetupNotice.css";

interface ThirdPartyAppsSetupNoticeProps {
  proxyRunning: boolean;
  hasProxyTarget: boolean;
  proxyBusy: boolean;
  proxyStartDisabledReason?: string;
  onStartProxy: () => void;
  onOpenAccounts: () => void;
  onOpenProviders: () => void;
  t: Translate;
}

export function ThirdPartyAppsSetupNotice(props: ThirdPartyAppsSetupNoticeProps) {
  const { proxyRunning, hasProxyTarget, t } = props;
  if (proxyRunning && hasProxyTarget) return null;

  return (
    <section className="third-party-apps-setup" aria-labelledby="third-party-apps-setup-title">
      <div className="third-party-apps-setup-message">
        <span className="third-party-apps-setup-icon" aria-hidden="true"><Info size={18} /></span>
        <div className="third-party-apps-setup-copy">
          <h2 id="third-party-apps-setup-title">
            {t(proxyRunning ? "thirdPartyApps.targetRequiredTitle" : "thirdPartyApps.proxyRequiredTitle")}
          </h2>
          <p>{t(proxyRunning ? "thirdPartyApps.targetRequired" : "thirdPartyApps.proxyRequired")}</p>
        </div>
      </div>
      <div className="third-party-apps-setup-actions">
        {proxyRunning ? <>
          <Button icon={<UserRound size={15} />} onClick={props.onOpenAccounts}>
            {t("thirdPartyApps.openAccounts")}<ArrowRight size={14} aria-hidden="true" />
          </Button>
          <Button icon={<SlidersHorizontal size={15} />} onClick={props.onOpenProviders}>
            {t("thirdPartyApps.openProviders")}<ArrowRight size={14} aria-hidden="true" />
          </Button>
        </> : <StartProxyButton {...props} />}
      </div>
    </section>
  );
}

function StartProxyButton(props: ThirdPartyAppsSetupNoticeProps) {
  const { proxyBusy, proxyStartDisabledReason, onStartProxy, t } = props;
  const disabled = proxyBusy || Boolean(proxyStartDisabledReason);
  return (
    <Popconfirm title={t("providers.proxy.startConfirmTitle")}
      description={<span className="proxy-start-confirm-description">{t("providers.proxy.description")}</span>}
      okText={t("providers.proxy.start")} cancelText={t("providers.proxy.cancel")}
      disabled={disabled} onConfirm={onStartProxy}>
      <Button type="primary" icon={<Play size={15} />} loading={proxyBusy} disabled={disabled}>
        {t("thirdPartyApps.openProxy")}
      </Button>
    </Popconfirm>
  );
}
