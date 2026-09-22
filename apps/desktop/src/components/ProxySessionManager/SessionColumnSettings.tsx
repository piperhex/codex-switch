import { useRef, useState } from "react";
import { Button, Checkbox, Dropdown, Tooltip } from "antd";
import { Columns3, GripVertical, Lock } from "lucide-react";
import type { Translate } from "../../i18n";
import { isReorderableColumnKey, type useSessionColumns } from "./useSessionColumns";
import styles from "./index.module.less";

type ColumnSettings = ReturnType<typeof useSessionColumns>;
type ReorderableColumnKey = Parameters<ColumnSettings["reorderColumn"]>[0];

export function SessionColumnSettings({ settings, t }: { settings: ColumnSettings; t: Translate }) {
  const { columnSettings, hiddenColumnSet, visibleColumnCount, setColumnVisible, reorderColumn, moveColumn } = settings;
  const draggedColumnRef = useRef<ReorderableColumnKey | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<ReorderableColumnKey | null>(null);
  const [dragTargetColumn, setDragTargetColumn] = useState<ReorderableColumnKey | null>(null);
  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      dropdownRender={() => (
        <div
          className={styles.columnSettings}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{t("table.columnSettings")}</strong>
          <div className={styles.columnSettingsList}>
            {columnSettings.map(({ key, label }) => {
              const checked = !hiddenColumnSet.has(key);
              const reorderable = isReorderableColumnKey(key);
              return (
                <div
                  key={key}
                  data-proxy-session-column-key={key}
                  className={[
                    styles.columnSettingItem,
                    draggedColumn === key ? styles.dragging : "",
                    dragTargetColumn === key ? styles.dragTarget : "",
                  ].filter(Boolean).join(" ")}
                >
                  {reorderable ? (
                    <span
                      className={styles.columnDragHandle}
                      role="button"
                      tabIndex={0}
                      title={t("table.columnOrderDrag", { column: label })}
                      aria-label={t("table.columnOrderDrag", { column: label })}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        draggedColumnRef.current = key;
                        setDraggedColumn(key);
                      }}
                      onPointerMove={(event) => {
                        if (!draggedColumnRef.current) return;
                        const item = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>("[data-proxy-session-column-key]");
                        const target = item?.dataset.proxySessionColumnKey;
                        setDragTargetColumn(
                          isReorderableColumnKey(target) ? target : null,
                        );
                      }}
                      onPointerUp={(event) => {
                        const source = draggedColumnRef.current;
                        const item = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>("[data-proxy-session-column-key]");
                        const target = item?.dataset.proxySessionColumnKey;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        draggedColumnRef.current = null;
                        setDraggedColumn(null);
                        setDragTargetColumn(null);
                        if (source && isReorderableColumnKey(target)) {
                          reorderColumn(source, target);
                        }
                      }}
                      onPointerCancel={() => {
                        draggedColumnRef.current = null;
                        setDraggedColumn(null);
                        setDragTargetColumn(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        event.preventDefault();
                        moveColumn(key, event.key === "ArrowUp" ? -1 : 1);
                      }}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </span>
                  ) : (
                    <Tooltip title={t("table.columnOrderFixedLast")}>
                      <span className={styles.columnFixedIcon}>
                        <Lock size={12} aria-hidden="true" />
                      </span>
                    </Tooltip>
                  )}
                  <Checkbox
                    checked={checked}
                    disabled={checked && visibleColumnCount <= 1}
                    onChange={(event) => setColumnVisible(key, event.target.checked)}
                  >
                    {label}
                  </Checkbox>
                </div>
              );
            })}
          </div>
        </div>
      )}
    >
      <Tooltip title={t("table.columnSettings")}>
        <Button
          size="small"
          className="table-icon-button"
          aria-label={t("table.columnSettings")}
          icon={<Columns3 size={15} />}
        />
      </Tooltip>
    </Dropdown>
  );
}
