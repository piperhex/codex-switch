import { Button, Popconfirm, Progress, Tooltip } from "antd";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import type { TotpEntry } from "../../utils/totp";

interface TotpCodeCardProps {
  code: string;
  copied: boolean;
  entry: TotpEntry;
  now: number;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  t: Translate;
}

function displayCode(code: string) {
  if (!code) return "••• •••";
  const splitAt = code.length / 2;
  return `${code.slice(0, splitAt)} ${code.slice(splitAt)}`;
}

export function TotpCodeCard({
  code,
  copied,
  entry,
  now,
  onCopy,
  onDelete,
  onEdit,
  t,
}: TotpCodeCardProps) {
  const elapsed = Math.floor(now / 1000) % entry.period;
  const remaining = entry.period - elapsed;
  return (
    <article className="totp-code-card">
      <div className="totp-code-heading">
        <div><strong>{entry.issuer}</strong><span>{entry.accountName}</span></div>
        <div className="totp-code-actions">
          <Tooltip title={t("totp.edit")} styles={{ root: { maxWidth: 400 } }}>
            <Button type="text" size="small" icon={<Pencil size={14} />} onClick={onEdit} />
          </Tooltip>
          <Popconfirm title={t("totp.deleteConfirm")} okText={t("table.delete")}
            cancelText={t("table.cancel")} okButtonProps={{ danger: true }} onConfirm={onDelete}>
            <Tooltip title={t("table.delete")} styles={{ root: { maxWidth: 400 } }}>
              <Button type="text" danger size="small" icon={<Trash2 size={14} />} />
            </Tooltip>
          </Popconfirm>
        </div>
      </div>
      <button type="button" className="totp-code-button" disabled={!code} onClick={onCopy}>
        <span className="totp-code-value">{displayCode(code)}</span>
        <span className="totp-copy-label"><Copy size={13} />{t(copied ? "totp.copied" : "totp.copy")}</span>
        <Progress type="circle" size={42} percent={(remaining / entry.period) * 100}
          strokeWidth={8} format={() => remaining} />
      </button>
    </article>
  );
}
