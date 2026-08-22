import { useEffect, useState } from 'react';
import { Button, Form, Input, SpinLoading, Toast } from 'antd-mobile';
import { Eye, EyeOff, Save } from 'lucide-react';
import { fetchAccountDetails, updateAccountDetails } from '../api';
import type { AccountPrivateDetails, AccountSummary } from '../types';
import { AdaptiveSheet } from './AdaptiveSheet';

interface AccountDetailsSheetProps {
  account: AccountSummary | null;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}

const EMPTY_PRIVATE_DETAILS: AccountPrivateDetails = { password: '', phoneNumber: '', totpSecret: '' };

export function AccountDetailsSheet({ account, onClose, onUpdated }: AccountDetailsSheetProps) {
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [privateDetails, setPrivateDetails] = useState(EMPTY_PRIVATE_DETAILS);
  const [hidden, setHidden] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    setNote(account.note);
    setExpiresAt(account.expiresAt);
    setPrivateDetails(account.privateDetails ?? EMPTY_PRIVATE_DETAILS);
    setHidden(true);
    setLoading(true);
    void fetchAccountDetails(account.id).then((details) => {
      setNote(details.note);
      setExpiresAt(details.expiresAt);
      setPrivateDetails(details.privateDetails ?? EMPTY_PRIVATE_DETAILS);
    }).catch((error) => {
      Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '读取账号详情失败' });
    }).finally(() => setLoading(false));
  }, [account]);

  const save = async () => {
    if (!account) return;
    setSaving(true);
    try {
      await updateAccountDetails(account.id, { note, expiresAt, privateDetails });
      Toast.show({ icon: 'success', content: '账号信息已保存' });
      onClose();
      await onUpdated();
    } catch (error) {
      Toast.show({ icon: 'fail', content: error instanceof Error ? error.message : '保存账号信息失败' });
    } finally {
      setSaving(false);
    }
  };

  return <AdaptiveSheet open={Boolean(account)} title="账号详情" subtitle={account?.email} onClose={onClose}>
    {loading ? <div className="sheet-loading"><SpinLoading color="primary" /><span>正在读取账号详情</span></div> : <Form layout="vertical" className="account-details-form" footer={<Button block color="primary" size="large" loading={saving} onClick={() => void save()}><Save size={16} />保存账号信息</Button>}>
      <Form.Item label="账号备注"><Input value={note} onChange={setNote} placeholder="添加备注" clearable /></Form.Item>
      <Form.Item label="到期时间"><Input value={expiresAt} onChange={setExpiresAt} placeholder="例如 2026-12-31" clearable /></Form.Item>
      <Form.Item label="密码"><div className="secret-input-row"><Input type={hidden ? 'password' : 'text'} value={privateDetails.password} onChange={(value) => setPrivateDetails((current) => ({ ...current, password: value }))} placeholder="可选" /><button type="button" onClick={() => setHidden((value) => !value)} aria-label={hidden ? '显示密码' : '隐藏密码'}>{hidden ? <Eye size={17} /> : <EyeOff size={17} />}</button></div></Form.Item>
      <Form.Item label="手机号"><Input value={privateDetails.phoneNumber} onChange={(value) => setPrivateDetails((current) => ({ ...current, phoneNumber: value }))} placeholder="可选" clearable /></Form.Item>
      <Form.Item label="2FA 密钥"><Input value={privateDetails.totpSecret} onChange={(value) => setPrivateDetails((current) => ({ ...current, totpSecret: value.toUpperCase() }))} placeholder="可选" clearable /></Form.Item>
    </Form>}
  </AdaptiveSheet>;
}
