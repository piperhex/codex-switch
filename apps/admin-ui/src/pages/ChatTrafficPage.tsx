import { useState } from "react";
import { Alert, Button, Card, DatePicker, Input, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { TrafficApi, UserChatTraffic } from "../chat-traffic-types";
import type { PageResult } from "../types";
import { useTrafficResource } from "../hooks/useTrafficResource";
import { useI18n } from "../i18n-context";
import { formatTrafficBytes } from "./chat-traffic-chart";
import { ChatTrafficDetailDrawer } from "./ChatTrafficDetailDrawer";
import { ChatTrafficLimitModal } from "./ChatTrafficLimitModal";
import "./chat-traffic.css";

function currentMonth() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" })
    .format(new Date());
}

export function ChatTrafficPage({ api, canManage, dark }: { api: TrafficApi; canManage: boolean; dark: boolean }) {
  const { language } = useI18n();
  const zh = language === "zh";
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<UserChatTraffic>();
  const [editing, setEditing] = useState<UserChatTraffic>();
  const query = new URLSearchParams({ month, search, page: String(page), pageSize: String(pageSize) });
  const { data, loading, error, refresh } = useTrafficResource<PageResult<UserChatTraffic>>(api,
    `/admin/api/chat-traffic/users?${query}`);
  const bytes = (value: number) => formatTrafficBytes(value, language);
  return <Space direction="vertical" size="large" className="chat-traffic-page" style={{ width: "100%" }}>
    <div><Typography.Title level={2}>{zh ? "聊天流量" : "Chat traffic"}</Typography.Title>
      <Typography.Paragraph type="secondary">{zh
        ? "查看所有用户的服务器转发流量和每小时明细，设置每月可用额度。P2P 直连不计入转发流量。"
        : "Review relay traffic and hourly usage for every user, and set monthly allowances. P2P traffic is excluded."}
      </Typography.Paragraph>
      <Typography.Text type="secondary">{zh
        ? "额度于每月 1 日按北京时间重置，-1 表示不限量。个人流量从本功能启用后开始统计。"
        : "Allowances reset on the first of each month (UTC+8); -1 means unlimited. User totals start when tracking is enabled."}
      </Typography.Text></div>
    <Card>
      <Space wrap style={{ marginBottom: 20 }}>
        <DatePicker picker="month" allowClear={false} value={dayjs(month)}
          aria-label={zh ? "统计月份" : "Reporting month"}
          onChange={(value) => { if (value) { setMonth(value.format("YYYY-MM")); setPage(1); } }} />
        <Input.Search placeholder={zh ? "搜索用户邮箱" : "Search user email"} allowClear style={{ width: 260 }}
          onSearch={(value) => { setSearch(value.trim()); setPage(1); }} />
        <Button onClick={() => void refresh()} loading={loading}>{zh ? "刷新" : "Refresh"}</Button>
      </Space>
      {error && <Alert type="error" showIcon style={{ marginBottom: 16 }}
        message={zh ? "流量加载失败，请重试。" : "Unable to load traffic. Please retry."} />}
      <Table<UserChatTraffic> rowKey="id" dataSource={data?.items ?? []} loading={loading && !data}
        scroll={{ x: 950 }} pagination={{ current: page, pageSize, total: data?.total ?? 0, showSizeChanger: true,
          onChange: (next, size) => { setPage(size !== pageSize ? 1 : next); setPageSize(size); } }} columns={[
          { title: zh ? "用户" : "User", dataIndex: "email", width: 240, ellipsis: true },
          { title: zh ? `${month} 转发量` : `${month} relay`, dataIndex: "monthBytes", render: bytes },
          { title: zh ? "累计转发量" : "Total relay", dataIndex: "totalBytes", render: bytes },
          { title: zh ? "本月已用 / 额度" : "Current month / allowance", render: (_, user) => <Space direction="vertical" size={2}>
            <span>{bytes(user.monthUsedBytes)} / {user.monthlyLimitBytes === -1
              ? (zh ? "不限量" : "Unlimited") : bytes(user.monthlyLimitBytes)}</span>
            {user.monthlyLimitBytes !== -1 && user.monthUsedBytes >= user.monthlyLimitBytes &&
              <Tag color="orange">{zh ? "额度已用完" : "Allowance exhausted"}</Tag>}
          </Space> },
          { title: zh ? "操作" : "Actions", render: (_, user) => <Space>
            <Button type="link" onClick={() => setSelected(user)}>{zh ? "查看详情" : "Details"}</Button>
            {canManage && <Button type="link" onClick={() => setEditing(user)}>{zh ? "设置额度" : "Set allowance"}</Button>}
          </Space> },
        ]} />
    </Card>
    {selected && <ChatTrafficDetailDrawer key={`${selected.id}:${month}`} user={selected} month={month}
      api={api} dark={dark} onClose={() => setSelected(undefined)} />}
    {editing && <ChatTrafficLimitModal key={editing.id} user={editing} api={api}
      onClose={() => setEditing(undefined)} onSaved={() => void refresh()} />}
  </Space>;
}
