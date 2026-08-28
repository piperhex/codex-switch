import { Input, Modal } from "antd";
import { useEffect, useState } from "react";
import {
  subscribeToHostedWebApiKeyRequests,
  type HostedWebApiKeyRequest,
} from "../../api/backend";
import { useLanguage } from "../../hooks/useLanguage";

export function HostedWebApiKeyModal() {
  const { t } = useLanguage();
  const [request, setRequest] = useState<HostedWebApiKeyRequest | null>(null);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeToHostedWebApiKeyRequests((nextRequest) => {
      setApiKey("");
      setRequest(nextRequest);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const resolveRequest = (value: string | null) => {
    if (!request) return;
    request.resolve(value);
    setRequest(null);
  };

  return (
    <Modal
      className="hosted-web-api-key-modal"
      open={Boolean(request)}
      width={400}
      centered
      title={t("hostedWebApiKey.title")}
      okText={t("hostedWebApiKey.confirm")}
      cancelText={t("hostedWebApiKey.cancel")}
      onOk={() => resolveRequest(apiKey.trim() || null)}
      onCancel={() => resolveRequest(null)}
    >
      <div className="hosted-web-api-key-form">
        <p>{t("hostedWebApiKey.description")}</p>
        <Input.Password
          autoFocus
          value={apiKey}
          placeholder={t("hostedWebApiKey.placeholder")}
          onChange={(event) => setApiKey(event.target.value)}
          onPressEnter={() => resolveRequest(apiKey.trim() || null)}
        />
      </div>
    </Modal>
  );
}
