import { useRef, useState } from "react";
import { Button, message } from "antd";
import { DollarSign } from "lucide-react";
import { loadProviders } from "../../api/backend";
import { recordToastLog } from "../../api/errorLogs";
import { translate, type Language, type Translate } from "../../i18n";
import type { Provider } from "../../types";
import { CustomTokenCostModal } from "../CustomTokenCostModal";

export function CustomBillingButton({ language }: { language: Language }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const loadingRef = useRef(false);
  const [messageApi, contextHolder] = message.useMessage();
  const t: Translate = (key, values) => translate(language, key, values);

  const openBilling = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      setProviders(await loadProviders());
      setOpen(true);
    } catch {
      const content = t("tokenCost.customBilling.loadFailed");
      void recordToastLog(content).catch(() => {
        console.debug("The notification could not be added to the error log.");
      });
      void messageApi.error({
        content,
        style: { maxWidth: 400, marginInline: "auto" },
      });
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  return <>
    {contextHolder}
    <Button icon={<DollarSign size={15} />} loading={loading} onClick={() => void openBilling()}>
      {t("tokenCost.settings.customBilling")}
    </Button>
    <CustomTokenCostModal open={open} providers={providers} t={t} onClose={() => setOpen(false)} />
  </>;
}
