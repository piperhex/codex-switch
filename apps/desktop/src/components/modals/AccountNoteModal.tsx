import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, DatePicker, Input, Progress } from "antd";
import dayjs from "dayjs";
import { Check, Copy, ScanQrCode, StickyNote, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { Account, AccountDetailsDraft } from "../../types";
import { generateTotp, normalizeTotpSecret, parseOtpAuthUri } from "../../utils/totp";
import { decodeQrImage, qrImportErrorMessage } from "../totp/qr";

const ACCOUNT_TOTP_PERIOD = 30;
const COPY_FEEDBACK_DURATION_MS = 1_600;

function initialPreviewSecret(secret: string) {
  try {
    return secret ? normalizeTotpSecret(secret) : "";
  } catch {
    return "";
  }
}

function CopyableAccountField({ children, label, value, t }: {
  children: ReactNode;
  label: string;
  value: string;
  t: Translate;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } catch {
      setCopied(false);
    }
  };

  return <div className="account-copy-field">
    {children}
    <button type="button" disabled={!value} onClick={() => void copy()}
      aria-label={copied ? t("totp.copied") : label} title={copied ? t("totp.copied") : label}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  </div>;
}

function AccountTotpPreview({ accountName, secret, t }: {
  accountName: string;
  secret: string;
  t: Translate;
}) {
  const [now, setNow] = useState(Date.now());
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const remaining = ACCOUNT_TOTP_PERIOD - (Math.floor(now / 1000) % ACCOUNT_TOTP_PERIOD);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void generateTotp({
      id: "account-preview",
      issuer: "ChatGPT",
      accountName,
      secret,
      algorithm: "SHA1",
      digits: 6,
      period: ACCOUNT_TOTP_PERIOD,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    }, now).then((value) => {
      if (active) setCode(value);
    }).catch(() => {
      if (active) setCode("");
    });
    return () => { active = false; };
  }, [accountName, now, secret]);

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

  return <button type="button" className="account-totp-preview" disabled={!code}
    onClick={() => void copyCode()} aria-label={t("totp.copy")} title={t("totp.copy")}>
    <span>
      <small>{t("note.totpPreview")}</small>
      <strong>{code ? `${code.slice(0, 3)} ${code.slice(3)}` : "••• •••"}</strong>
    </span>
    <span className="account-totp-copy">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {t(copied ? "totp.copied" : "totp.copy")}
    </span>
    <Progress type="circle" size={38} percent={(remaining / ACCOUNT_TOTP_PERIOD) * 100}
      strokeWidth={8} format={() => remaining} />
  </button>;
}

export function AccountNoteModal({
  account,
  onClose,
  onSave,
  t,
}: {
  account: Account;
  onClose: () => void;
  onSave: (details: AccountDetailsDraft) => Promise<boolean>;
  t: Translate;
}) {
  const [note, setNote] = useState(account.note);
  const [expiresAt, setExpiresAt] = useState(account.expiresAt);
  const [password, setPassword] = useState(account.privateDetails.password);
  const [phoneNumber, setPhoneNumber] = useState(account.privateDetails.phoneNumber);
  const [totpSecret, setTotpSecret] = useState(account.privateDetails.totpSecret);
  const [previewSecret, setPreviewSecret] = useState(
    () => initialPreviewSecret(account.privateDetails.totpSecret),
  );
  const [totpError, setTotpError] = useState("");
  const [totpImported, setTotpImported] = useState(false);
  const [readingQr, setReadingQr] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qrFileInputRef = useRef<HTMLInputElement>(null);

  const importQrCode = async (file: File) => {
    setReadingQr(true);
    try {
      const draft = parseOtpAuthUri(await decodeQrImage(file));
      setTotpSecret(draft.secret);
      setPreviewSecret(draft.secret);
      setTotpError("");
      setTotpImported(true);
    } catch (cause) {
      setTotpImported(false);
      setPreviewSecret("");
      setTotpError(qrImportErrorMessage(cause, t));
    } finally {
      setReadingQr(false);
    }
  };

  const showTotpPreview = () => {
    if (!totpSecret.trim()) {
      setPreviewSecret("");
      setTotpError("");
      return;
    }
    try {
      const secret = totpSecret.trim().toLowerCase().startsWith("otpauth://")
        ? parseOtpAuthUri(totpSecret).secret
        : normalizeTotpSecret(totpSecret);
      setTotpSecret(secret);
      setPreviewSecret(secret);
      setTotpError("");
    } catch {
      setPreviewSecret("");
      setTotpError(t("note.totpInvalid"));
    }
  };

  const save = async () => {
    if (saving || readingQr) return;
    let normalizedTotpSecret = "";
    try {
      normalizedTotpSecret = !totpSecret.trim()
        ? ""
        : totpSecret.trim().toLowerCase().startsWith("otpauth://")
          ? parseOtpAuthUri(totpSecret).secret
          : normalizeTotpSecret(totpSecret);
      setTotpError("");
    } catch {
      setTotpError(t("note.totpInvalid"));
      return;
    }
    setSaving(true);
    const saved = await onSave({
      expiresAt,
      note,
      privateDetails: { password, phoneNumber: phoneNumber.trim(), totpSecret: normalizedTotpSecret },
    });
    setSaving(false);
    if (saved) onClose();
    else textareaRef.current?.focus();
  };

  return (
    <div className="modal-backdrop account-note-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <form className="modal account-note-modal" role="dialog" aria-modal="true"
        aria-labelledby="account-note-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <button type="button" className="modal-close" aria-label={t("note.close")}
          disabled={saving} onClick={onClose}><X size={18} /></button>
        <div className="account-note-scroll">
          <div className="modal-icon"><StickyNote size={22} /></div>
          <h2 id="account-note-title">{t("note.title")}</h2>
          <p>{t("note.description", { email: account.email })}</p>
          <div className="account-details-grid">
            <div className="account-form-field">
              <label className="account-note-label" htmlFor="account-expiration-date">
                {t("note.expirationDate")}
              </label>
              <DatePicker id="account-expiration-date" className="account-expiration-picker"
                value={expiresAt ? dayjs(expiresAt, "YYYY-MM-DD") : null} picker="date"
                format="YYYY-MM-DD" placeholder="YYYY-MM-DD"
                allowClear onChange={(date) => setExpiresAt(date?.format("YYYY-MM-DD") ?? "")} />
              <span className="account-expiration-hint">{t("note.expirationHint")}</span>
            </div>
            <div className="account-form-field">
              <label className="account-note-label" htmlFor="account-phone-number">{t("note.phoneNumber")}</label>
              <CopyableAccountField value={phoneNumber} label={t("note.copyPhoneNumber")} t={t}>
                <Input id="account-phone-number" value={phoneNumber} maxLength={64}
                  placeholder={t("note.phonePlaceholder")} onChange={(event) => setPhoneNumber(event.target.value)} />
              </CopyableAccountField>
            </div>
            <div className="account-form-field">
              <label className="account-note-label" htmlFor="account-password">{t("note.password")}</label>
              <CopyableAccountField value={password} label={t("note.copyPassword")} t={t}>
                <Input.Password id="account-password" value={password} maxLength={1024}
                  autoComplete="new-password" placeholder={t("note.passwordPlaceholder")}
                  onChange={(event) => setPassword(event.target.value)} />
              </CopyableAccountField>
            </div>
            <div className="account-form-field">
              <label className="account-note-label" htmlFor="account-totp-secret">{t("note.totp")}</label>
              <Input.Password id="account-totp-secret" value={totpSecret} maxLength={1024}
                status={totpError ? "error" : undefined} autoComplete="off" placeholder={t("note.totpPlaceholder")}
                onChange={(event) => {
                  setTotpSecret(event.target.value);
                  setPreviewSecret("");
                  setTotpError("");
                  setTotpImported(false);
                }} onBlur={showTotpPreview} />
              <div className="account-totp-meta">
                <div className="account-totp-tools">
                  <input ref={qrFileInputRef} type="file" accept="image/*" hidden onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void importQrCode(file);
                  }} />
                  <Button size="small" icon={<ScanQrCode size={14} />} loading={readingQr} disabled={saving}
                    onClick={() => qrFileInputRef.current?.click()}>{t("totp.scanQr")}</Button>
                  {(totpError || totpImported) && (
                    <span className={`account-private-hint${totpError ? " error" : " success"}`}>
                      {totpError || t("totp.qrImported")}
                    </span>
                  )}
                </div>
                {previewSecret && <AccountTotpPreview accountName={account.email} secret={previewSecret} t={t} />}
              </div>
            </div>
            <div className="account-form-field">
              <label className="account-note-label" htmlFor="account-note-textarea">{t("note.label")}</label>
              <textarea ref={textareaRef} id="account-note-textarea" className="account-note-textarea"
                rows={5} value={note} placeholder={t("note.placeholder")}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    void save();
                  }
                }} />
            </div>
          </div>
        </div>
        <div className="account-note-footer">
          <span>{t("note.shortcut")}</span>
          <div>
            <button type="button" className="note-cancel-button" disabled={saving} onClick={onClose}>
              {t("note.cancel")}
            </button>
            <button type="submit" className="primary-button" disabled={saving || readingQr}>
              {saving ? t("note.saving") : t("note.save")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
