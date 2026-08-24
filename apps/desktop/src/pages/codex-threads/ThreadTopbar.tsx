import { Dropdown } from "antd";
import {
  ArchiveRestore, ChevronDown, Download, Eye, Import, Power, RefreshCw, Upload,
} from "lucide-react";
import type { ThreadCopy } from "./copy";

interface ThreadTopbarProps {
  text: ThreadCopy;
  busy: boolean;
  selectedCount: number;
  runSync: () => void;
  restartChatGpt: () => void;
  openImport: () => void;
  openExport: () => void;
  migrateSelected: () => void;
  openRepair: () => void;
  openBin: () => void;
}

export function ThreadTopbar(props: ThreadTopbarProps) {
  const {
    text, busy, selectedCount, runSync, restartChatGpt, openImport, openExport, migrateSelected,
    openRepair, openBin,
  } = props;
  return (
    <>
      <button className="refresh-all" disabled={busy} onClick={runSync}>
        <RefreshCw className={busy ? "spin" : undefined} size={16} />{text.sync}
      </button>
      <button className="refresh-all" disabled={busy} onClick={restartChatGpt}>
        <Power size={16} />{text.restartChatGpt}
      </button>
      <Dropdown trigger={["click"]} menu={{
        items: [
          { key: "import", icon: <Import size={15} />, label: text.import },
          {
            key: "export",
            icon: <Download size={15} />,
            label: `${text.export} (${selectedCount})`,
            disabled: !selectedCount,
          },
        ],
        onClick: ({ key }) => {
          if (key === "import") openImport();
          if (key === "export") openExport();
        },
      }}>
        <button className="refresh-all" disabled={busy}>
          <Upload size={16} />{text.transfer}<ChevronDown size={14} />
        </button>
      </Dropdown>
      <button className="refresh-all" disabled={busy || !selectedCount} onClick={migrateSelected}>
        {text.migrate}
      </button>
      <button className="refresh-all" disabled={busy} onClick={openRepair}>
        <Eye size={16} />{text.repair}
      </button>
      <button className="refresh-all" disabled={busy} onClick={openBin}>
        <ArchiveRestore size={16} />{text.bin}
      </button>
    </>
  );
}
