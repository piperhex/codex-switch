import { useState } from "react";
import { Alert, Button, Drawer, Space, Table, Typography } from "antd";
import type { TrafficApi, UserChatTraffic, UserChatTrafficDetail } from "../chat-traffic-types";
import { useTrafficResource } from "../hooks/useTrafficResource";
import { useI18n } from "../i18n-context";
import { ChatTrafficPanel } from "./ChatTrafficPanel";
import { formatTrafficBytes } from "./chat-traffic-chart";

export function ChatTrafficDetailDrawer({ user, month, api, dark, onClose }: {
  user: UserChatTraffic; month: string; api: TrafficApi; dark: boolean; onClose: () => void;
}) {
  const { language } = useI18n();
  const zh = language === "zh";
  const [selectedDate, setSelectedDate] = useState<string>();
  const { data, loading, error, refresh } = useTrafficResource<UserChatTrafficDetail>(api,
    `/admin/api/chat-traffic/users/${user.id}?month=${month}`);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const selected = data?.daily.find((day) => day.date === (selectedDate ?? today)) ?? data?.daily.at(-1);
  const hours = selected?.hourlyBytes.map((bytes, hour) => ({
    time: `${selected.date} ${String(hour).padStart(2, "0")}:00`, bytes,
  })) ?? [];
  return <Drawer open title={zh ? "用户流量详情" : "User traffic details"} width={1000} onClose={onClose}>
    <Space direction="vertical" size="large" className="chat-traffic-detail" style={{ width: "100%" }}>
      <Space wrap><Typography.Text strong>{user.email}</Typography.Text><Typography.Text>{month}</Typography.Text>
        <Button loading={loading} onClick={() => void refresh()}>{zh ? "刷新" : "Refresh"}</Button></Space>
      {error && <Alert type="error" showIcon message={zh ? "流量加载失败，请重试。" : "Unable to load traffic. Please retry."} />}
      <ChatTrafficPanel data={data} loading={loading} dark={dark} date={selected?.date} onDateChange={setSelectedDate} />
      <Typography.Title level={5}>{zh ? "每小时明细（北京时间）" : "Hourly details (UTC+8)"}</Typography.Title>
      <Table rowKey="time" size="small" dataSource={hours} loading={loading && !data}
        pagination={false} columns={[
          { title: zh ? "时间" : "Time", dataIndex: "time" },
          { title: zh ? "转发流量" : "Relay traffic", dataIndex: "bytes", align: "right",
            render: (bytes: number) => formatTrafficBytes(bytes, language) },
          { title: zh ? "字节数" : "Bytes", dataIndex: "bytes", align: "right",
            render: (bytes: number) => bytes.toLocaleString() },
        ]} />
    </Space>
  </Drawer>;
}
