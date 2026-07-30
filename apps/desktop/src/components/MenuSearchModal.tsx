import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Translate } from "../i18n";

export type MenuSearchItem = {
  id: string;
  label: string;
  group: string;
  disabled?: boolean;
};

export function MenuSearchModal({ items, onClose, onSelect, t }: {
  items: MenuSearchItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
  t: Translate;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return items.filter((item) => (
      `${item.label} ${item.group}`.toLocaleLowerCase().includes(normalizedQuery)
    ));
  }, [items, query]);
  const enabledResults = results.filter((item) => !item.disabled);
  const activeItem = enabledResults[activeIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (item: MenuSearchItem | undefined) => {
    if (!item || item.disabled) return;
    onSelect(item.id);
  };

  return (
    <div className="menu-search-backdrop" onClick={onClose}>
      <section
        className="menu-search-dialog"
        role="dialog"
        aria-label={t("menuSearch.label")}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "ArrowDown" && enabledResults.length) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % enabledResults.length);
            return;
          }
          if (event.key === "ArrowUp" && enabledResults.length) {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + enabledResults.length) % enabledResults.length);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            choose(activeItem);
          }
        }}
      >
        <div className="menu-search-field">
          <Search size={24} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            aria-label={t("menuSearch.placeholder")}
            placeholder={t("menuSearch.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label={t("menuSearch.clear")} onClick={() => setQuery("")}>
              <X size={17} />
            </button>
          )}
        </div>

        <div className="menu-search-results" role="listbox" aria-label={t("menuSearch.results")}>
          {!query.trim() ? (
            <div className="menu-search-empty">
              <Search size={34} aria-hidden="true" />
              <span>{t("menuSearch.hint")}</span>
            </div>
          ) : results.length ? (
            results.map((item) => {
              const enabledIndex = enabledResults.indexOf(item);
              const active = enabledIndex >= 0 && enabledIndex === activeIndex;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={active ? "active" : undefined}
                  role="option"
                  aria-selected={active}
                  disabled={item.disabled}
                  onMouseEnter={() => {
                    if (enabledIndex >= 0) setActiveIndex(enabledIndex);
                  }}
                  onClick={() => choose(item)}
                >
                  <Search size={16} aria-hidden="true" />
                  <span>{item.label}</span>
                  {active && <kbd>↵</kbd>}
                </button>
              );
            })
          ) : (
            <div className="menu-search-empty">
              <Search size={34} aria-hidden="true" />
              <span>{t("menuSearch.noResults")}</span>
            </div>
          )}
        </div>

        <footer className="menu-search-footer">
          <span><kbd>↵</kbd>{t("menuSearch.confirm")}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd>{t("menuSearch.switch")}</span>
          <span><kbd>Esc</kbd>{t("menuSearch.close")}</span>
        </footer>
      </section>
    </div>
  );
}
