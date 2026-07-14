import { useCallback, useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Modal, Spin, Typography } from "antd";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SystemAccount } from "../../types";

interface SystemAccountOAuthModalProps {
  open: boolean;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface OAuthStartResult {
  sessionId: string;
  verificationUrl: string;
  userCode: string;
  interval: number;
  expiresIn: number;
}

type OAuthPollResult =
  | { status: "pending" }
  | { status: "complete"; account: SystemAccount }
  | { status: "failed"; message?: string };

export function SystemAccountOAuthModal({
  api,
  onClose,
  onSaved,
  open,
}: SystemAccountOAuthModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [session, setSession] = useState<OAuthStartResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const start = useCallback(async () => {
    setStarting(true);
    setFailure(null);
    setSession(null);
    try {
      const result = await api<OAuthStartResult>("/admin/api/official-accounts/oauth/start", {
        method: "POST",
      });
      setSession(result);
    } catch (error) {
      const detail = (error as Error).message;
      setFailure(detail);
      message.error(detail);
    } finally {
      setStarting(false);
    }
  }, [api, message]);

  useEffect(() => {
    if (open) void start();
  }, [open, start]);

  useEffect(() => {
    if (!open || !session || failure) return;
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const result = await api<OAuthPollResult>(
          `/admin/api/official-accounts/oauth/${session.sessionId}/poll`,
          { method: "POST" },
        );
        if (!active) return;
        if (result.status === "complete") {
          message.success(t("officialAccounts.oauthSuccess"));
          await onSaved();
          onClose();
          return;
        }
        if (result.status === "failed") {
          const detail = result.message || t("officialAccounts.oauthFailed");
          setFailure(detail);
          message.error(detail);
          return;
        }
        timer = window.setTimeout(poll, Math.max(1, session.interval) * 1000);
      } catch (error) {
        if (!active) return;
        const detail = (error as Error).message;
        setFailure(detail);
        message.error(detail);
      }
    };

    timer = window.setTimeout(poll, Math.max(1, session.interval) * 1000);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, failure, message, onClose, onSaved, open, session, t]);

  function openAuthorizationPage() {
    if (!session) return;
    window.open(session.verificationUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Modal
      title={t("officialAccounts.oauthTitle")}
      open={open}
      onCancel={onClose}
      onOk={failure ? () => void start() : openAuthorizationPage}
      okText={failure ? t("officialAccounts.oauthRetry") : t("officialAccounts.oauthOpen")}
      okButtonProps={{
        disabled: !failure && !session,
        icon: failure ? <RefreshCw size={15} /> : <ExternalLink size={15} />,
      }}
      confirmLoading={starting}
      destroyOnClose
      width={520}
    >
      <div className="oauth-content">
        {starting && <Spin tip={t("officialAccounts.oauthStarting")} />}
        {failure && <Alert type="error" showIcon message={t("officialAccounts.oauthFailed")} description={failure} />}
        {session && !failure && (
          <>
            <Typography.Paragraph type="secondary">
              {t("officialAccounts.oauthInstruction")}
            </Typography.Paragraph>
            <div className="oauth-code">
              <Typography.Text type="secondary">{t("officialAccounts.oauthCode")}</Typography.Text>
              <Typography.Text className="oauth-code-value" copyable={{ text: session.userCode }}>
                {session.userCode}
              </Typography.Text>
            </div>
            <div className="oauth-waiting">
              <Spin size="small" />
              <Typography.Text type="secondary">{t("officialAccounts.oauthWaiting")}</Typography.Text>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
