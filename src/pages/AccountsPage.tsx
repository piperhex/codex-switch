import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import type { Account } from "../types";
import { AccountTable } from "../components/accounts/AccountTable";

export function AccountsPage({ accounts, loading, busyAccountId, onAdd, onSwitch, onRefresh, onDelete }: {
  accounts: Account[];
  loading: boolean;
  busyAccountId: string | null;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) return <div className="loading-state"><RefreshCw className="spin" />正在读取本地账户…</div>;
  if (!accounts.length) {
    return (
      <div className="empty-state">
        <div><LogIn size={28} /></div><h2>还没有保存的账户</h2>
        <p>登录 ChatGPT，或导入已有的 auth.json 开始管理。</p>
        <button className="primary-button" onClick={onAdd}>添加第一个账户<ArrowRight size={17} /></button>
      </div>
    );
  }
  return <AccountTable accounts={accounts} busyAccountId={busyAccountId}
    onSwitch={onSwitch} onRefresh={onRefresh} onDelete={onDelete} />;
}
