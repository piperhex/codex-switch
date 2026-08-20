import { Button, Space, Tag } from "antd";
import { Network, Power } from "lucide-react";
import type { Translate } from "../../i18n";
import type { AggregateApi, Provider } from "../../types";

interface AggregateApiOverviewProps {
  aggregates: AggregateApi[];
  providers: Provider[];
  busyId: string | null;
  proxyRunning: boolean;
  onManage: () => void;
  onSwitch: (id: string) => Promise<boolean>;
  onDeactivate: (id: string) => void;
  t: Translate;
}

export function AggregateApiOverview(props: AggregateApiOverviewProps) {
  if (!props.aggregates.length) return null;
  return <section className="aggregate-api-overview">
    <div className="aggregate-api-overview-title">
      <Space size={7}><Network size={17} /><strong>{props.t("providers.aggregate.title")}</strong></Space>
      <Button type="link" size="small" onClick={props.onManage}>
        {props.t("providers.aggregate.manage")}
      </Button>
    </div>
    <div className="aggregate-api-overview-grid">
      {props.aggregates.filter((aggregate) => aggregate.enabled).map((aggregate) => {
        const members = aggregate.memberProviderIds
          .map((id) => props.providers.find((provider) => provider.id === id)?.name)
          .filter(Boolean).join(" + ");
        const waiting = props.busyId === `aggregate:${aggregate.id}`;
        return <article className={aggregate.active ? "aggregate-api-card active" : "aggregate-api-card"}
          key={aggregate.id}>
          <div><Space size={6}><strong>{aggregate.name}</strong>
            {aggregate.active && <Tag color="green">{props.t("providers.aggregate.active")}</Tag>}
          </Space><small>{aggregate.model}</small><span title={members}>{members}</span></div>
          <Button size="small" type={aggregate.active ? "default" : "primary"}
            icon={<Power size={13} />} loading={waiting}
            disabled={!props.proxyRunning && !aggregate.active}
            onClick={() => aggregate.active
              ? props.onDeactivate(`aggregate:${aggregate.id}`)
              : void props.onSwitch(aggregate.id)}>
            {aggregate.active
              ? props.t("providers.action.cancelUse") : props.t("providers.action.switch")}
          </Button>
        </article>;
      })}
    </div>
  </section>;
}
