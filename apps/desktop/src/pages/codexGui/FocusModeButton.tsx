import { Button, Tooltip } from "antd";
import { Maximize, Minimize } from "lucide-react";

export interface GuiFocusMode {
  focused: boolean;
  onToggleFocus: () => void;
}

export function FocusModeButton({ focused, onToggleFocus }: GuiFocusMode) {
  const label = focused ? "退出专注模式" : "进入专注模式";
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="text" size="small" aria-label={label} aria-pressed={focused} onClick={onToggleFocus}
      icon={focused ? <Minimize size={15} /> : <Maximize size={15} />} />
  </Tooltip>;
}
