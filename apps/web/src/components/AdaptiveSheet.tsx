import { Grid, Modal } from "antd";
import { Popup, SafeArea } from "antd-mobile";
import type { ReactNode } from "react";

interface AdaptiveSheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  width?: number;
}

export function AdaptiveSheet({
  open,
  title,
  subtitle,
  onClose,
  onBack,
  children,
  width = 520,
}: AdaptiveSheetProps) {
  const screens = Grid.useBreakpoint();
  const back = onBack && <button type="button" className="sheet-close" onClick={onBack}
    aria-label="返回上一层">‹</button>;
  const heading = <div className="modal-heading"><strong>{title}</strong>
    {subtitle ? <span>{subtitle}</span> : null}</div>;
  if (screens.md) {
    return <Modal open={open} onCancel={onClose} footer={null} width={width} centered destroyOnClose
      title={onBack ? <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{back}{heading}</div> : heading}>
      {children}
    </Modal>;
  }
  return <Popup visible={open} onMaskClick={onClose} destroyOnClose bodyClassName="mobile-popup">
    <div className="sheet-handle" />
    <div className="sheet-header">{back}<div style={onBack ? { flex: 1 } : undefined}>
      <h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
      <button type="button" className="sheet-close" onClick={onClose} aria-label="关闭">×</button></div>
    <div className="adaptive-sheet-content">{children}</div>
    <SafeArea position="bottom" />
  </Popup>;
}
