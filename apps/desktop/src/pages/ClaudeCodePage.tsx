import { Button, Card, Select, Space, Typography } from "antd";
import { Bot, Play, RefreshCw } from "lucide-react";
import type { ClaudeCodeWriteTarget } from "../types";
import type { Translate } from "../i18n";

interface ClaudeCodePageProps {
  target: ClaudeCodeWriteTarget;
  busy: "launch" | "restart" | null;
  onTargetChange: (target: ClaudeCodeWriteTarget) => void;
  onLaunch: () => void;
  onRestart: () => void;
  t: Translate;
}

export function ClaudeCodePage({
  target,
  busy,
  onTargetChange,
  onLaunch,
  onRestart,
  t,
}: ClaudeCodePageProps) {
  return (
    <div className="claude-code-page">
      <Card className="claude-code-card">
        <div className="claude-code-card-heading">
          <span className="claude-code-icon"><Bot size={22} /></span>
          <div>
            <Typography.Title level={3}>{t("claudeCode.title")}</Typography.Title>
            <Typography.Paragraph>{t("claudeCode.description")}</Typography.Paragraph>
          </div>
        </div>
        <div className="claude-code-setting">
          <div>
            <Typography.Text strong>{t("claudeCode.writeTarget")}</Typography.Text>
            <Typography.Paragraph type="secondary">
              {t("claudeCode.writeTargetHint")}
            </Typography.Paragraph>
          </div>
          <Select<ClaudeCodeWriteTarget>
            value={target}
            aria-label={t("claudeCode.writeTarget")}
            onChange={onTargetChange}
            options={[
              { value: "all", label: t("claudeCode.targetAll") },
              { value: "codex", label: t("claudeCode.targetCodex") },
              { value: "claudeCode", label: t("claudeCode.targetClaude") },
            ]}
          />
        </div>
        <div className="claude-code-actions">
          <Space wrap>
            <Button type="primary" icon={<Play size={15} />} loading={busy === "launch"}
              onClick={onLaunch}>
              {t("claudeCode.launch")}
            </Button>
            <Button icon={<RefreshCw size={15} />} loading={busy === "restart"}
              onClick={onRestart}>
              {t("claudeCode.restart")}
            </Button>
          </Space>
          <Typography.Text type="secondary">{t("claudeCode.restartHint")}</Typography.Text>
        </div>
      </Card>
    </div>
  );
}
