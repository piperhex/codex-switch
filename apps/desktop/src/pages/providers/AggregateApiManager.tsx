import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Form, Input, Modal, Popconfirm, Select, Space, Switch, Tag } from "antd";
import { Edit3, Plus, Power, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import type { AggregateApi, AggregateApiInput, Provider } from "../../types";

interface AggregateApiManagerProps {
  open: boolean;
  aggregates: AggregateApi[];
  providers: Provider[];
  saving: boolean;
  busyId: string | null;
  proxyRunning: boolean;
  onClose: () => void;
  onSave: (input: AggregateApiInput) => Promise<AggregateApi | null>;
  onSwitch: (id: string) => Promise<boolean>;
  onDeactivate: (id: string) => void;
  onDelete: (id: string) => void;
  t: Translate;
}

interface AggregateFormValues {
  name: string;
  model: string;
  memberProviderIds: string[];
  enabled: boolean;
}

function providerModels(provider: Provider) {
  return [...new Set([provider.model, ...provider.models].filter(Boolean))];
}

function availableModels(providers: Provider[]) {
  const counts = new Map<string, number>();
  for (const provider of providers) {
    for (const model of providerModels(provider)) {
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .map(([model]) => ({ label: model, value: model }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function AggregateApiManager(props: AggregateApiManagerProps) {
  const { aggregates, providers, saving, busyId, proxyRunning, onClose, onSave, t } = props;
  const [form] = Form.useForm<AggregateFormValues>();
  const [editing, setEditing] = useState<AggregateApi | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const selectedModel = Form.useWatch("model", form);
  const modelOptions = useMemo(() => availableModels(providers), [providers]);
  const memberOptions = providers
    .filter((provider) => selectedModel && providerModels(provider).includes(selectedModel))
    .map((provider) => ({ label: provider.name, value: provider.id }));

  useEffect(() => {
    if (!props.open) {
      setShowEditor(false);
      setEditing(null);
      form.resetFields();
    }
  }, [form, props.open]);

  const openEditor = (aggregate?: AggregateApi) => {
    setEditing(aggregate ?? null);
    form.setFieldsValue({
      name: aggregate?.name ?? "",
      model: aggregate?.model,
      memberProviderIds: aggregate?.memberProviderIds ?? [],
      enabled: aggregate?.enabled ?? true,
    });
    setShowEditor(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const saved = await onSave({ id: editing?.id, ...values });
    if (saved) {
      setShowEditor(false);
      setEditing(null);
      form.resetFields();
    }
  };

  return <Modal open={props.open} width={760} title={t("providers.aggregate.manageTitle")}
    onCancel={onClose} footer={null} destroyOnHidden>
    <div className="aggregate-api-manager">
      <div className="aggregate-api-manager-heading">
        <p>{t("providers.aggregate.description")}</p>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => openEditor()}>
          {t("providers.aggregate.create")}
        </Button>
      </div>
      {!aggregates.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t("providers.aggregate.empty")} /> : (
        <div className="aggregate-api-list">
          {aggregates.map((aggregate) => {
            const memberNames = aggregate.memberProviderIds
              .map((id) => providers.find((provider) => provider.id === id)?.name)
              .filter(Boolean).join(" + ");
            const waiting = busyId === `aggregate:${aggregate.id}`;
            return <div className="aggregate-api-row" key={aggregate.id}>
              <div><Space size={6}><strong>{aggregate.name}</strong>
                {aggregate.active && <Tag color="green">{t("providers.aggregate.active")}</Tag>}
                {!aggregate.enabled && <Tag>{t("providers.aggregate.disabled")}</Tag>}</Space>
                <small>{aggregate.model}</small><span title={memberNames}>{memberNames}</span></div>
              <Space size={4}>
                <Button size="small" icon={<Power size={13} />} loading={waiting}
                  disabled={!aggregate.enabled || (!proxyRunning && !aggregate.active)}
                  onClick={() => aggregate.active
                    ? props.onDeactivate(`aggregate:${aggregate.id}`)
                    : void props.onSwitch(aggregate.id)}>
                  {aggregate.active ? t("providers.action.cancelUse") : t("providers.action.switch")}
                </Button>
                <Button size="small" icon={<Edit3 size={13} />} onClick={() => openEditor(aggregate)} />
                <Popconfirm title={t("providers.aggregate.deleteTitle")} placement="topRight"
                  onConfirm={() => props.onDelete(aggregate.id)}>
                  <Button size="small" danger icon={<Trash2 size={13} />} />
                </Popconfirm>
              </Space>
            </div>;
          })}
        </div>
      )}
    </div>
    <Modal open={showEditor} title={editing
      ? t("providers.aggregate.editTitle") : t("providers.aggregate.createTitle")}
      onCancel={() => setShowEditor(false)} onOk={() => void save()} confirmLoading={saving}
      okText={t("providers.aggregate.save")} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="name" label={t("providers.aggregate.name")}
          rules={[{ required: true, whitespace: true, message: t("providers.aggregate.error.nameRequired") }] }>
          <Input maxLength={80} placeholder={t("providers.aggregate.namePlaceholder")} />
        </Form.Item>
        <Form.Item name="model" label={t("providers.aggregate.model")}
          rules={[{ required: true, message: t("providers.aggregate.error.modelRequired") }] }>
          <Select showSearch options={modelOptions} placeholder={t("providers.aggregate.modelPlaceholder")}
            onChange={() => form.setFieldValue("memberProviderIds", [])} />
        </Form.Item>
        <Form.Item name="memberProviderIds" label={t("providers.aggregate.members")}
          rules={[{ type: "array", min: 2, message: t("providers.aggregate.error.membersRequired") }] }>
          <Select mode="multiple" options={memberOptions}
            placeholder={t("providers.aggregate.membersPlaceholder")} />
        </Form.Item>
        <Form.Item name="enabled" label={t("providers.aggregate.enabled")} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  </Modal>;
}
