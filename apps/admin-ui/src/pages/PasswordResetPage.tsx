import { useEffect, useState } from "react";
import { App as AntApp, Button, Card, Form, Input, Result, Segmented, Space } from "antd";
import { Languages } from "lucide-react";
import { LANGUAGE_OPTIONS, type Language } from "../i18n";
import { useI18n } from "../i18n-context";

interface PasswordResetValues {
  email: string;
  verificationCode: string;
  newPassword: string;
  confirmPassword: string;
}

export function PasswordResetPage() {
  const { message } = AntApp.useApp();
  const { language, setLanguage, t } = useI18n();
  const [form] = Form.useForm<PasswordResetValues>();
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => setCodeCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  async function requestCode() {
    const email = await form.validateFields(["email"]).then((values) => values.email);
    setSendingCode(true);
    try {
      const response = await fetch("/auth/password-reset/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || response.statusText);
      setCodeCooldown(60);
      message.success(t("forgotPassword.codeSent"));
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSendingCode(false);
    }
  }

  async function resetPassword(values: PasswordResetValues) {
    setSubmitting(true);
    try {
      const response = await fetch("/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          verificationCode: values.verificationCode,
          newPassword: values.newPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || response.statusText);
      setComplete(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <Card className="login-card">
        {complete ? (
          <Result
            status="success"
            title={t("forgotPassword.success")}
            extra={<Button type="primary" onClick={() => window.location.assign("/admin")}>{t("forgotPassword.backToLogin")}</Button>}
          />
        ) : (
          <>
            <div className="login-brand">
              <div className="login-brand-row">
                <div>
                  <h1>{t("forgotPassword.title")}</h1>
                  <span>{t("forgotPassword.description")}</span>
                </div>
                <div className="language-control" aria-label={t("language.label")}>
                  <Languages size={15} />
                  <Segmented
                    size="small"
                    value={language}
                    options={[...LANGUAGE_OPTIONS]}
                    onChange={(value) => setLanguage(value as Language)}
                  />
                </div>
              </div>
            </div>
            <Form form={form} layout="vertical" onFinish={resetPassword}>
              <Form.Item name="email" label={t("common.email")} rules={[{ required: true, type: "email" }]}>
                <Input autoComplete="email" />
              </Form.Item>
              <Form.Item
                name="verificationCode"
                label={t("forgotPassword.verificationCode")}
                rules={[{ required: true, pattern: /^\d{6}$/, message: t("forgotPassword.codeRequired") }]}
              >
                <Space.Compact block>
                  <Input
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    onChange={(event) => form.setFieldValue(
                      "verificationCode",
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )}
                  />
                  <Button
                    onClick={() => void requestCode()}
                    loading={sendingCode}
                    disabled={submitting || codeCooldown > 0}
                  >
                    {codeCooldown > 0
                      ? t("forgotPassword.resendCountdown", { seconds: codeCooldown })
                      : t("forgotPassword.sendCode")}
                  </Button>
                </Space.Compact>
              </Form.Item>
              <Form.Item name="newPassword" label={t("forgotPassword.newPassword")} rules={[{ required: true, min: 8 }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label={t("forgotPassword.confirmPassword")}
                dependencies={["newPassword"]}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      return !value || getFieldValue("newPassword") === value
                        ? Promise.resolve()
                        : Promise.reject(new Error(t("forgotPassword.passwordMismatch")));
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Button type="primary" htmlType="submit" block loading={submitting}>{t("forgotPassword.submit")}</Button>
                <Button type="link" block onClick={() => window.location.assign("/admin")}>{t("forgotPassword.backToLogin")}</Button>
              </Space>
            </Form>
          </>
        )}
      </Card>
    </div>
  );
}
