import { Progress } from "antd";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import type { Translate } from "../../i18n";
import { generateTotp, normalizeTotpSecret } from "../../utils/totp";

const ACCOUNT_TOTP_PERIOD = 30;
const ACCOUNT_TOTP_ID = "account-preview";
const ACCOUNT_TOTP_ISSUER = "ChatGPT";
const ACCOUNT_TOTP_ORIGIN = "1970-01-01T00:00:00.000Z";
const COPY_FEEDBACK_DURATION_MS = 1_600;
const MILLISECONDS_PER_SECOND = 1_000;

interface AccountTotpPreviewProps {
  accountName: string;
  masked?: boolean;
  secret: string;
  t: Translate;
  variant?: "card" | "inline";
}

function useAccountTotpCode(accountName: string, secret: string) {
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let normalizedSecret = "";
    try {
      normalizedSecret = normalizeTotpSecret(secret);
    } catch {
      setCode("");
      return undefined;
    }
    void generateTotp({
      id: ACCOUNT_TOTP_ID,
      issuer: ACCOUNT_TOTP_ISSUER,
      accountName,
      secret: normalizedSecret,
      algorithm: "SHA1",
      digits: 6,
      period: ACCOUNT_TOTP_PERIOD,
      createdAt: ACCOUNT_TOTP_ORIGIN,
      updatedAt: ACCOUNT_TOTP_ORIGIN,
    }, now).then((value) => {
      if (active) setCode(value);
    }).catch(() => {
      if (active) setCode("");
    });
    return () => { active = false; };
  }, [accountName, now, secret]);

  const elapsed = Math.floor(now / MILLISECONDS_PER_SECOND) % ACCOUNT_TOTP_PERIOD;
  return { code, remaining: ACCOUNT_TOTP_PERIOD - elapsed };
}

function displayCode(code: string, masked: boolean) {
  if (!code || masked) return "••• •••";
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function AccountTotpPreview({
  accountName,
  masked = false,
  secret,
  t,
  variant = "card",
}: AccountTotpPreviewProps) {
  const { code, remaining } = useAccountTotpCode(accountName, secret);
  const [copied, setCopied] = useState(false);
  const inline = variant === "inline";

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } catch {
      setCopied(false);
    }
  };

  return <button type="button" className={`account-totp-preview${inline ? " account-totp-preview-inline" : ""}`}
    disabled={!code} onClick={() => void copyCode()} aria-label={t("totp.copy")} title={t("totp.copy")}>
    <span>
      {!inline && <small>{t("note.totpPreview")}</small>}
      <strong>{displayCode(code, masked)}</strong>
    </span>
    <span className="account-totp-copy">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {t(copied ? "totp.copied" : "totp.copy")}
    </span>
    {!inline && <Progress type="circle" size={38} percent={(remaining / ACCOUNT_TOTP_PERIOD) * 100}
      strokeWidth={8} format={() => remaining} />}
  </button>;
}
