import { useCallback, useRef, useState } from "react";
import { Button, Popconfirm, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Clock3, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { fetchResetCredits } from "../../api/backend";
import type { Account } from "../../types";
import { formatUpdated, initials } from "../../utils/format";
import { ResetCreditsPanel, type ResetCreditsLoadState } from "./ResetCreditsPanel";
import { UsageMeter } from "./UsageMeter";

interface AccountTableProps {
  accounts: Account[];
  busyAccountId: string | null;
  onSwitch: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AccountTable({ accounts, busyAccountId, onSwitch, onRefresh, onDelete }: AccountTableProps) {
  const [resetCredits, setResetCredits] = useState<Record<string, ResetCreditsLoadState>>({});
  const resetCreditRequests = useRef(new Set<string>());

  const loadResetCredits = useCallback(async (account: Account, force = false) => {
    if (resetCreditRequests.current.has(account.id)) return;
    if (!force && resetCredits[account.id]) return;
    resetCreditRequests.current.add(account.id);
    setResetCredits((current) => ({ ...current, [account.id]: { status: "loading" } }));
    try {
      const data = await fetchResetCredits(account.id);
      setResetCredits((current) => ({ ...current, [account.id]: { status: "loaded", data } }));
    } catch (error) {
      setResetCredits((current) => ({ ...current, [account.id]: { status: "error", error: String(error) } }));
    } finally {
      resetCreditRequests.current.delete(account.id);
    }
  }, [resetCredits]);

  const columns: ColumnsType<Account> = [
    {
      title: "账号", dataIndex: "email", width: 300, fixed: "left",
      sorter: (left, right) => left.email.localeCompare(right.email),
      render: (_, account) => (
        <div className="account-cell">
          <div className="table-avatar">{initials(account.email)}</div>
          <div className="account-primary">
            <div className="account-email" title={account.email}>{account.email}</div>
            <div className="account-meta">{account.active ? <Tag color="success">当前</Tag> : <Tag>备用</Tag>}</div>
          </div>
        </div>
      ),
    },
    {
      title: "套餐 / ID", width: 190,
      render: (_, account) => (
        <div className="plan-stack">
          <Tag className="plan-tag">{account.plan || "ChatGPT"}</Tag>
          <span className="account-id" title={account.accountId ?? ""}>
            {account.accountId ? `工作区 · ${account.accountId.slice(0, 12)}` : "个人账户"}
          </span>
        </div>
      ),
    },
    { title: "5 小时", width: 150, render: (_, account) => <UsageMeter window={account.usage.primary} /> },
    { title: "1 周", width: 150, render: (_, account) => <UsageMeter window={account.usage.secondary} /> },
    {
      title: "更新", width: 126,
      render: (_, account) => (
        <div className="updated-cell">
          <Clock3 size={13} /><span>{formatUpdated(account.usage.fetchedAt)}</span>
          {account.usage.error && <Tooltip title={account.usage.error}><Tag color="error">错误</Tag></Tooltip>}
        </div>
      ),
    },
    {
      title: "操作", width: 176, align: "right", fixed: "right",
      render: (_, account) => {
        const waiting = busyAccountId === account.id;
        return (
          <Space size={4} className="table-actions">
            <Button size="small" type={account.active ? "default" : "primary"} disabled={account.active}
              loading={waiting} icon={account.active ? <Check size={14} /> : <RotateCcw size={14} />}
              onClick={() => onSwitch(account.id)}>{account.active ? "使用中" : "切换"}</Button>
            <Tooltip title="刷新用量">
              <Button size="small" className="table-icon-button" loading={waiting}
                icon={<RefreshCw size={14} />} onClick={() => onRefresh(account.id)} />
            </Tooltip>
            <Popconfirm title="确认删除此账户？" description="只会删除本地保存的账户，不会注销 ChatGPT。"
              okText="删除" cancelText="取消" okButtonProps={{ danger: true }} disabled={account.active}
              onConfirm={() => onDelete(account.id)}>
              <Tooltip title={account.active ? "正在使用的账户无法删除" : "删除账户"}>
                <Button danger size="small" className="table-icon-button" aria-label="删除账户"
                  disabled={account.active} icon={<Trash2 size={14} />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="account-table-wrap">
      <Table rowKey="id" size="small" columns={columns} dataSource={accounts} pagination={false}
        rowClassName={(account) => (account.active ? "active-row" : "")}
        expandable={{
          columnWidth: 42,
          expandedRowRender: (account) => <ResetCreditsPanel state={resetCredits[account.id]}
            onRetry={() => void loadResetCredits(account, true)} />,
          onExpand: (expanded, account) => { if (expanded) void loadResetCredits(account); },
        }}
        scroll={{ x: 1134 }} />
    </div>
  );
}
