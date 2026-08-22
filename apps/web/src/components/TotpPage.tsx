import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button, Dialog, Empty, Form, Input, SpinLoading, Switch, Toast } from 'antd-mobile';
import { Clipboard, Plus, QrCode, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useAppSelector } from '../hooks';
import { generateTotp, normalizeTotpSecret, parseOtpAuthUri } from '../totp';
import type { TotpEntry } from '../types';
import { useTotpVault } from '../useTotpVault';
import { AdaptiveSheet } from './AdaptiveSheet';

interface TotpDraft {
  issuer: string;
  accountName: string;
  secret: string;
}

const EMPTY_DRAFT: TotpDraft = { issuer: '', accountName: '', secret: '' };

async function scanQrFile(file: File) {
  const detectorType = (window as unknown as {
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>>;
    };
  }).BarcodeDetector;
  if (!detectorType) throw new Error('当前浏览器不支持二维码识别，请手动粘贴密钥');
  const bitmap = await createImageBitmap(file);
  try {
    const results = await new detectorType({ formats: ['qr_code'] }).detect(bitmap);
    const value = results[0]?.rawValue;
    if (!value) throw new Error('没有识别到有效的二维码');
    return value;
  } finally {
    bitmap.close();
  }
}

function useCodes(entries: TotpEntry[]) {
  const [now, setNow] = useState(Date.now());
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(entries.map(async (entry) => [entry.id, await generateTotp(entry, now)] as const))
      .then((values) => { if (!cancelled) setCodes(Object.fromEntries(values)); });
    return () => { cancelled = true; };
  }, [entries, now]);
  return { codes, now };
}

export function TotpPage() {
  const session = useAppSelector((state) => state.auth.session);
  const manager = useTotpVault(session);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<TotpEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<TotpDraft>(EMPTY_DRAFT);
  const { codes, now } = useCodes(manager.entries);
  const sortedEntries = useMemo(
    () => [...manager.entries].sort((left, right) => left.issuer.localeCompare(right.issuer)),
    [manager.entries],
  );

  const openForm = (entry?: TotpEntry) => {
    setEditing(entry ?? null);
    setDraft(entry ? { issuer: entry.issuer, accountName: entry.accountName, secret: entry.secret } : EMPTY_DRAFT);
    setFormOpen(true);
  };

  const save = () => {
    try {
      const parsed = draft.secret.trim().toLowerCase().startsWith('otpauth://')
        ? parseOtpAuthUri(draft.secret)
        : {
          issuer: draft.issuer.trim(),
          accountName: draft.accountName.trim(),
          secret: normalizeTotpSecret(draft.secret),
          algorithm: editing?.algorithm ?? 'SHA1',
          digits: editing?.digits ?? 6,
          period: editing?.period ?? 30,
        };
      manager.saveEntry(parsed, editing?.id);      setFormOpen(false);
      Toast.show({ icon: 'success', content: '2FA 密钥已保存' });
    } catch (error) {
      Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '2FA 密钥无效' });
    }
  };

  const importQr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = parseOtpAuthUri(await scanQrFile(file));
      setEditing(null);
      setDraft(parsed);
      setFormOpen(true);
    } catch (error) {
      Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '二维码识别失败' });
    }
  };

  const refresh = async () => {
    try {
      const result = await manager.refreshCloud();
      const messages = { empty: '云端暂无 2FA 密钥', current: '2FA 密钥已是最新', updated: '已获取云端 2FA 密钥' };
      Toast.show({ icon: result === 'empty' ? 'fail' : 'success', content: messages[result] });
    } catch (error) {
      Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '获取云端 2FA 密钥失败' });
    }
  };

  return <>
    <div className="page-body totp-page">
      <header className="page-heading"><div><span>安全工具</span><h1>2FA 验证码</h1></div>
        <div className="totp-heading-actions"><Button size="small" onClick={() => fileRef.current?.click()}><QrCode size={15} />识别二维码</Button><Button size="small" color="primary" onClick={() => openForm()}><Plus size={15} />手动添加</Button></div>
      </header>
      <section className="totp-sync-card"><ShieldCheck size={20} /><div><strong>云端同步</strong><span>开启后会与手机端共享 2FA 密钥</span></div><Switch checked={manager.cloudSyncEnabled} onChange={manager.setCloudSyncEnabled} /></section>
      <div className="section-toolbar"><div><h2>动态验证码</h2><span>点击验证码即可复制</span></div><Button size="small" loading={manager.syncing} onClick={() => void refresh()}><RefreshCw size={15} />同步</Button></div>
      {!manager.initialized ? <div className="page-loading"><SpinLoading color="primary" /><span>正在读取 2FA 密钥</span></div>
        : !sortedEntries.length ? <Empty className="page-empty" description="还没有 2FA 密钥" />
          : <div className="totp-grid">{sortedEntries.map((entry) => {
            const code = codes[entry.id] ?? '------';
            const seconds = entry.period - (Math.floor(now / 1000) % entry.period);
            return <article className="totp-card" key={entry.id}><div className="totp-card-header"><div><strong>{entry.issuer || '未命名'}</strong><span>{entry.accountName}</span></div><button type="button" onClick={() => void Dialog.confirm({ title: '删除 2FA 密钥？', content: entry.issuer, confirmText: '删除' }).then((confirmed) => { if (confirmed) manager.deleteEntry(entry.id); })}><Trash2 size={16} /></button></div><button type="button" className="totp-code" onClick={() => void navigator.clipboard.writeText(code).then(() => Toast.show({ icon: 'success', content: '验证码已复制' }))}><span>{code.slice(0, 3)}</span><span>{code.slice(3)}</span><Clipboard size={15} /></button><div className="totp-progress"><i style={{ width: `${(seconds / entry.period) * 100}%` }} /></div><footer><span>{seconds} 秒</span><button type="button" onClick={() => openForm(entry)}>编辑</button></footer></article>;
          })}</div>}
      <input ref={fileRef} hidden type="file" accept="image/*" onChange={(event) => void importQr(event)} />
    </div>
    <AdaptiveSheet open={formOpen} title={editing ? '编辑 2FA 密钥' : '添加 2FA 密钥'} subtitle="支持 Base32 密钥或 otpauth:// 地址" onClose={() => setFormOpen(false)}>
      <Form layout="vertical" footer={<Button block color="primary" size="large" onClick={save}>保存密钥</Button>}>
        <Form.Item label="服务名称"><Input value={draft.issuer} onChange={(value) => setDraft((current) => ({ ...current, issuer: value }))} placeholder="例如 OpenAI" /></Form.Item>
        <Form.Item label="账号名称"><Input value={draft.accountName} onChange={(value) => setDraft((current) => ({ ...current, accountName: value }))} placeholder="name@example.com" /></Form.Item>
        <Form.Item label="2FA 密钥"><Input value={draft.secret} onChange={(value) => setDraft((current) => ({ ...current, secret: value }))} placeholder="Base32 或 otpauth://" /></Form.Item>
      </Form>
    </AdaptiveSheet>
  </>;
}
