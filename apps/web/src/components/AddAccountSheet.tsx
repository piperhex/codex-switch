import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button, Dialog, Input, SpinLoading, Toast } from 'antd-mobile';
import { ClipboardPaste, FileInput, KeyRound, Link2 } from 'lucide-react';
import { importPersonalAccounts, pollAccountOAuth, startAccountOAuth } from '../api';
import type { AccountImportResult } from '../types';
import { AdaptiveSheet } from './AdaptiveSheet';

interface AddAccountSheetProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}

interface OAuthState {
  sessionId: string;
  verificationUrl: string;
  userCode: string;
  interval: number;
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function resultMessage(result: AccountImportResult) {
  return result.skippedCount
    ? `已导入 ${result.importedCount} 个账号，跳过 ${result.skippedCount} 个`
    : `已导入 ${result.importedCount} 个账号`;
}

export function AddAccountSheet({ open, onClose, onAdded }: AddAccountSheetProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [oauth, setOauth] = useState<OAuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) setOauth(null);
  }, [open]);

  useEffect(() => {
    if (!oauth) return undefined;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const result = await pollAccountOAuth(oauth.sessionId);
        if (result.status === 'complete') {
          Toast.show({ icon: 'success', content: '账号已添加' });
          setOauth(null);
          onClose();
          await onAdded();
        } else if (result.status === 'failed') {
          Toast.show({ icon: 'fail', content: result.message || '授权失败，请重试' });
          setOauth(null);
        }
      } catch (error) {
        Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '授权检查失败' });
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void poll(), Math.max(oauth.interval, 2) * 1000);
    void poll();
    return () => window.clearInterval(timer);
  }, [oauth, onAdded, onClose]);

  const importContent = async (content: string) => {
    if (!content.trim()) throw new Error('没有读取到 JSON 内容');
    if (new Blob([content]).size > MAX_IMPORT_BYTES) throw new Error('导入文件不能超过 5 MB');
    setImporting(true);
    try {
      const result = await importPersonalAccounts(content);
      Toast.show({ icon: 'success', content: resultMessage(result) });
      if (result.skipped.length) {
        await Dialog.alert({ title: '部分账号未导入', content: result.skipped.slice(0, 3).join('\n'), confirmText: '知道了' });
      }
      onClose();
      await onAdded();
    } catch (error) {
      Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '导入失败，请检查 JSON 内容' });
    } finally {
      setImporting(false);
    }
  };

  const chooseFile = () => fileRef.current?.click();
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await importContent(await file.text());
  };

  const pasteClipboard = async () => {
    try { await importContent(await navigator.clipboard.readText()); }
    catch (error) { Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '无法读取剪贴板' }); }
  };

  const beginOAuth = async () => {
    setBusy(true);
    try { setOauth(await startAccountOAuth()); }
    catch (error) { Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '无法开始授权' }); }
    finally { setBusy(false); }
  };

  return <AdaptiveSheet open={open} title="添加账户" subtitle="选择一种安全的导入方式" onClose={onClose}>
    {oauth ? <div className="oauth-import-panel">
      <div className="oauth-import-icon"><KeyRound size={22} /></div>
      <h3>在 ChatGPT 中完成授权</h3>
      <p>打开授权页面，输入下方一次性验证码。完成后本页面会自动更新。</p>
      <a className="oauth-link" href={oauth.verificationUrl} target="_blank" rel="noreferrer"><Link2 size={15} />打开授权页面</a>
      <div className="oauth-code-value">{oauth.userCode}</div>
      <Button block onClick={() => void navigator.clipboard.writeText(oauth.userCode)}>复制验证码</Button>
      <div className="sheet-loading"><SpinLoading color="primary" /><span>等待授权完成…</span></div>
    </div> : <>
      <div className="add-account-options">
        <button type="button" disabled={busy || importing} onClick={() => void beginOAuth()}><KeyRound size={20} /><span><strong>ChatGPT 授权</strong><small>使用浏览器完成安全登录</small></span></button>
        <button type="button" disabled={busy || importing} onClick={chooseFile}><FileInput size={20} /><span><strong>导入 JSON 文件</strong><small>支持 auth.json 和兼容导出格式</small></span></button>
        <button type="button" disabled={busy || importing} onClick={() => void pasteClipboard()}><ClipboardPaste size={20} /><span><strong>从剪贴板导入</strong><small>粘贴账号 JSON 内容即可</small></span></button>
      </div>
      <input ref={fileRef} hidden type="file" accept=".json,application/json,text/plain" onChange={(event) => void handleFile(event)} />
    </>}
  </AdaptiveSheet>;
}
