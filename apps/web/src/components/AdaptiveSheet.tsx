import { Grid, Modal } from "antd";
import { Popup, SafeArea } from "antd-mobile";
import type { ReactNode } from "react";

interface AdaptiveSheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export function AdaptiveSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 520,
}: AdaptiveSheetProps) {
  const screens = Grid.useBreakpoint();
  if (screens.md) {
    return <Modal open={open} onCancel={onClose} footer={null} width={width} centered destroyOnClose
      title={<div className="modal-heading"><strong>{title}</strong>{subtitle ? <span>{subtitle}</span> : null}</div>}>
      {children}
    </Modal>;
  }
  return <Popup visible={open} onMaskClick={onClose} destroyOnClose bodyClassName="mobile-popup">
    <div className="sheet-handle" />
    <div className="sheet-header"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
      <button type="button" className="sheet-close" onClick={onClose} aria-label="关闭">×</button></div>
    <div className="adaptive-sheet-content">{children}</div>
    <SafeArea position="bottom" />
  </Popup>;
}
