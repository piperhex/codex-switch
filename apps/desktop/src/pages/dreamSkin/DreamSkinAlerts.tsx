import { Alert, Button, Progress } from "antd";
import { CloudDownload } from "lucide-react";
import { retryDreamSkinResources } from "../../api/backend";
import type { Translate } from "../../i18n";
import type { DreamSkinResourcesStatus } from "../../types";
import { formatResourceBytes } from "./formatters";

type Props = {
  error: string | null;
  resources: DreamSkinResourcesStatus | null;
  resourcePercent: number;
  setError: (error: string | null) => void;
  setResources: (resources: DreamSkinResourcesStatus) => void;
  t: Translate;
};

export function DreamSkinAlerts(props: Props) {
  const { error, resources, resourcePercent, setError, setResources, t } = props;
  return <>
    {error && <Alert className="dream-skin-error" type="error" showIcon closable
      message={t("dreamSkin.error")} description={error} onClose={() => setError(null)} />}
    {resources?.phase !== "ready" && resources?.phase !== "unsupported" && (
      <Alert className="dream-skin-error" type={resources?.phase === "error" ? "error" : "info"}
        showIcon icon={<CloudDownload size={18} />} message={resourceMessage(resources, t)}
        description={resourceDescription(resources, resourcePercent, setResources, t)} />
    )}
  </>;
}

function resourceMessage(resources: DreamSkinResourcesStatus | null, t: Translate) {
  if (resources?.phase === "downloading") return t("dreamSkin.resources.downloading");
  if (resources?.phase === "error") return t("dreamSkin.resources.failed");
  return t("dreamSkin.resources.checking");
}

function resourceDescription(
  resources: DreamSkinResourcesStatus | null,
  resourcePercent: number,
  setResources: (resources: DreamSkinResourcesStatus) => void,
  t: Translate,
) {
  if (resources?.phase === "downloading") {
    return <div>
      <p>{t("dreamSkin.resources.progress", {
        downloaded: formatResourceBytes(resources.downloadedBytes),
        total: formatResourceBytes(resources.totalBytes),
      })}</p>
      <Progress percent={resourcePercent} size="small" status="active" />
    </div>;
  }
  if (resources?.phase === "error") {
    return <div>
      <p>{resources.error || t("dreamSkin.resources.failedDescription")}</p>
      <Button size="small" onClick={() => void retryDreamSkinResources().then(setResources)}>
        {t("dreamSkin.resources.retry")}
      </Button>
    </div>;
  }
  return t("dreamSkin.resources.checkingDescription");
}
