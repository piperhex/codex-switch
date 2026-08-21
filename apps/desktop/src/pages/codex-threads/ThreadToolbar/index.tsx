import { Button, Input, Select } from "antd";
import { Search, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { CodexThreadKind } from "../../../types";
import type { ThreadCopy } from "../copy";
import styles from "./index.module.less";

interface ThreadToolbarProps {
  text: ThreadCopy;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  queueSearch: (query: string) => void;
  search: () => void;
  clearSearch: () => void;
  kind: CodexThreadKind | "all";
  setKind: Dispatch<SetStateAction<CodexThreadKind | "all">>;
  selectedCount: number;
  busy: boolean;
  confirmTrash: () => void;
}

export function ThreadToolbar(props: ThreadToolbarProps) {
  const { text, query, setQuery, queueSearch, search, clearSearch, kind, setKind } = props;
  const { selectedCount, busy, confirmTrash } = props;
  return (
    <div className={styles.codexThreadToolbar}>
      <Input
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          queueSearch(nextQuery);
        }}
        onPressEnter={search}
        prefix={<Search size={17} />}
        placeholder={text.searchPlaceholder}
        suffix={query ? (
          <button className={styles.threadInputClear} onClick={clearSearch} aria-label={text.clear}>
            <X size={15} />
          </button>
        ) : null}
      />
      <Select value={kind} onChange={setKind} options={[
        { value: "conversation", label: text.conversation },
        { value: "external", label: text.external },
        { value: "subagent", label: text.subagent },
        { value: "all", label: text.allKinds },
      ]} />
      <Button
        icon={<Trash2 size={16} />}
        danger
        disabled={!selectedCount || busy}
        onClick={confirmTrash}
      >
        {text.moveToBin} ({selectedCount})
      </Button>
    </div>
  );
}
