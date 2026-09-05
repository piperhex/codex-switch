import { Modal, Tooltip } from "antd";
import { LoaderCircle } from "lucide-react";
import { canManageCodexConnection } from "../../api/backend";
import { useCodexConnection } from "../../hooks/useCodexConnection";
import type { Translate } from "../../i18n";
import "./CodexConnectionControl.css";

interface CodexConnectionControlProps {
  blocked: boolean;
  onOperationChange: (operation: "start" | "restart" | null) => void;
  notify: (message: string) => void;
  t: Translate;
}

export function CodexConnectionControl(props: CodexConnectionControlProps) {
  const { blocked, t } = props;
  const connection = useCodexConnection(props);
  const { state, operation, restartRequired } = connection;
  const displayState = operation ? "connecting" : state;
  const pending = state === "checking" || state === "connecting" || operation !== null;
  const connected = state === "connected";
  const disabled = blocked || pending || connected || !canManageCodexConnection || state === "unsupported";
  const label = t(`codexConnection.${displayState}`);
  const tooltipKey = displayState === "disconnected" ? "codexConnection.connectHint"
    : `codexConnection.${displayState}Hint` as const;
  const tooltip = t(!canManageCodexConnection && state !== "unsupported"
    ? "codexConnection.readOnlyHint" : tooltipKey);

  return (
    <>
      <Tooltip title={tooltip} styles={{ root: { maxWidth: 400 } }}>
        <span className="codex-connection-wrap">
          <button type="button" className={`codex-connection-control is-${displayState}`}
            disabled={disabled} aria-label={label} aria-busy={pending}
            onClick={() => void connection.connect()}>
            {pending && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
            <span aria-live="polite">{label}</span>
            <span className="codex-connection-dot" aria-hidden="true" />
          </button>
        </span>
      </Tooltip>
      <Modal open={restartRequired} width={400} title={t("codexConnection.restartTitle")}
        okText={t("codexConnection.restartAction")} cancelText={t("codexConnection.cancel")}
        confirmLoading={operation === "restart"} okButtonProps={{ disabled: blocked || operation !== null }}
        cancelButtonProps={{ disabled: operation !== null }} closable={operation === null}
        maskClosable={operation === null} keyboard={operation === null}
        onOk={() => void connection.confirmRestart()} onCancel={connection.cancelRestart}>
        <p className="codex-connection-confirm-copy">{t("codexConnection.restartDescription")}</p>
      </Modal>
    </>
  );
}
