import { Button, Switch, Table, type TableColumnsType } from "antd";
import { Pencil, Trash2 } from "lucide-react";
import type { Translate } from "../../i18n";
import styles from "./index.module.less";
import type { SystemPromptListItem, SystemPromptRuleKind } from "./types";
import type { RuleEditor } from "./useRuleEditor";

const RULE_PREVIEW_CHAR_LIMIT = 200;

interface RuleTableProps {
  editor: RuleEditor;
  items: SystemPromptListItem[];
  loading: boolean;
  t: Translate;
}

function rulePreview(value: string) {
  const characters = Array.from(value);
  return characters.length > RULE_PREVIEW_CHAR_LIMIT
    ? `${characters.slice(0, RULE_PREVIEW_CHAR_LIMIT).join("")}…`
    : value;
}

function kindLabel(kind: SystemPromptRuleKind, t: Translate) {
  return t(kind === "filter" ? "systemPrompts.filter" : "systemPrompts.injection");
}

function RuleActions({ editor, item, loading, t }: {
  editor: RuleEditor;
  item: SystemPromptListItem;
  loading: boolean;
  t: Translate;
}) {
  return (
    <div className={styles.ruleActions}>
      <Switch aria-label={t("systemPrompts.toggleRule")} checked={item.enabled} disabled={loading}
        onChange={(enabled) => void editor.toggleRule(item, enabled)} size="small" />
      <Button aria-label={t("systemPrompts.editRule")} disabled={loading} icon={<Pencil size={15} />}
        onClick={() => editor.beginEdit(item)} type="text" />
      <Button aria-label={t("systemPrompts.deleteRule")} danger disabled={loading} icon={<Trash2 size={15} />}
        onClick={() => void editor.deleteRule(item)} type="text" />
    </div>
  );
}

function tableColumns(props: Pick<RuleTableProps, "editor" | "loading" | "t">) {
  const { editor, loading, t } = props;
  return [
    {
      title: t("systemPrompts.ruleName"),
      dataIndex: "name",
      key: "name",
      width: 180,
      render: (name: string | undefined) => {
        const displayName = name?.trim() || t("systemPrompts.unnamedRule");
        return <span className={styles.ruleName}>{displayName}</span>;
      },
    },
    {
      title: t("systemPrompts.ruleType"),
      dataIndex: "kind",
      key: "kind",
      width: 110,
      render: (kind: SystemPromptRuleKind) => (
        <span className={`${styles.typeBadge} ${styles[kind]}`}>{kindLabel(kind, t)}</span>
      ),
    },
    {
      title: t("systemPrompts.ruleContent"),
      dataIndex: "text",
      key: "text",
      width: 230,
      render: (text: string) => (
        <span className={styles.rulePreview}>{rulePreview(text)}</span>
      ),
    },
    {
      title: t("systemPrompts.ruleActions"),
      key: "actions",
      width: 160,
      align: "center",
      render: (_value: unknown, item: SystemPromptListItem) => (
        <RuleActions editor={editor} item={item} loading={loading} t={t} />
      ),
    },
  ] satisfies TableColumnsType<SystemPromptListItem>;
}

export function RuleTable(props: RuleTableProps) {
  const { editor, items, loading, t } = props;
  return (
    <Table<SystemPromptListItem>
      className={styles.ruleTable}
      rowKey="key"
      columns={tableColumns({ editor, loading, t })}
      dataSource={items}
      pagination={false}
      scroll={{ x: 680 }}
      size="small"
      tableLayout="fixed"
      locale={{ emptyText: t("systemPrompts.emptyRules") }}
    />
  );
}
