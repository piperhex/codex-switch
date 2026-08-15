import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Select } from "antd";
import { Plus, Search } from "lucide-react";
import type { Translate } from "../i18n";
import type { useTotpEntries } from "../hooks/useTotpEntries";
import { generateTotp, type TotpEntry } from "../utils/totp";
import { buildTotpIssuerOptions, filterTotpEntries } from "./totp/filter";
import { TotpCodeCard } from "./totp/TotpCodeCard";
import { TotpFormModal } from "./totp/TotpFormModal";

interface TotpManagerProps {
  boundEntries?: TotpEntry[];
  manager: ReturnType<typeof useTotpEntries>;
  t: Translate;
}

function useTotpCodes(entries: TotpEntry[]) {
  const [now, setNow] = useState(Date.now());
  const [codes, setCodes] = useState<Record<string, string>>({});
  const counterKey = useMemo(() => entries.map((entry) => (
    `${entry.id}:${Math.floor(now / 1000 / entry.period)}`
  )).join("|"), [entries, now]);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all(entries.map(async (entry) => [entry.id, await generateTotp(entry)] as const))
      .then((values) => { if (current) setCodes(Object.fromEntries(values)); });
    return () => { current = false; };
  }, [counterKey, entries]);

  return { codes, now };
}

export function TotpManager({ boundEntries = [], manager, t }: TotpManagerProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TotpEntry | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [issuerFilter, setIssuerFilter] = useState("");
  const entries = useMemo(() => [...boundEntries, ...manager.entries], [boundEntries, manager.entries]);
  const boundEntryIds = useMemo(() => new Set(boundEntries.map((entry) => entry.id)), [boundEntries]);
  const issuerOptions = useMemo(() => buildTotpIssuerOptions(entries), [entries]);
  const filteredEntries = useMemo(() => filterTotpEntries(entries, {
    accountQuery,
    issuer: issuerFilter,
  }), [accountQuery, entries, issuerFilter]);
  const { codes, now } = useTotpCodes(entries);

  useEffect(() => {
    if (issuerFilter && !issuerOptions.some((option) => option.value === issuerFilter)) {
      setIssuerFilter("");
    }
  }, [issuerFilter, issuerOptions]);

  const openForm = (entry: TotpEntry | null) => {
    setEditing(entry);
    setFormOpen(true);
  };

  const copyCode = async (entry: TotpEntry) => {
    const code = codes[entry.id];
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId((current) => current === entry.id ? null : current), 1_800);
  };

  return (
    <>
      <div className="totp-manager-actions">
        <Button type="primary" icon={<Plus size={14} />} onClick={() => openForm(null)}>
          {t("totp.add")}
        </Button>
      </div>
      {entries.length ? <>
        <div className="totp-manager-filters">
          <Input allowClear prefix={<Search size={14} />} value={accountQuery}
            aria-label={t("totp.accountSearch")} placeholder={t("totp.accountSearchPlaceholder")}
            onChange={(event) => setAccountQuery(event.target.value)} />
          <Select showSearch optionFilterProp="label" value={issuerFilter}
            aria-label={t("totp.serviceFilter")} onChange={setIssuerFilter}
            options={[{ label: t("totp.allServices"), value: "" }, ...issuerOptions]} />
        </div>
        {filteredEntries.length ? <div className="totp-code-grid">
          {filteredEntries.map((entry) => <TotpCodeCard key={entry.id} entry={entry}
            code={codes[entry.id] ?? ""} now={now} copied={copiedId === entry.id}
            onCopy={() => void copyCode(entry)}
            onDelete={boundEntryIds.has(entry.id) ? undefined : () => manager.deleteEntry(entry.id)}
            onEdit={boundEntryIds.has(entry.id) ? undefined : () => openForm(entry)}
            badge={boundEntryIds.has(entry.id) ? t("totp.accountBound") : undefined} t={t} />)}
        </div> : <Empty className="totp-empty" description={t("totp.filterEmpty")} />}
      </> : <Empty className="totp-empty" description={t("totp.empty")} />}
      <TotpFormModal open={formOpen} entry={editing} t={t}
        onCancel={() => setFormOpen(false)} onSave={(draft) => {
          if (editing) manager.updateEntry(editing.id, draft);
          else manager.addEntry(draft);
        }} />
    </>
  );
}
