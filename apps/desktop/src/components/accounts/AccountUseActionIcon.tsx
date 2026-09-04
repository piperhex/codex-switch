import { CircleOff, Power } from "lucide-react";

interface AccountUseActionIconProps {
  active: boolean;
}

export function AccountUseActionIcon({ active }: AccountUseActionIconProps) {
  return active ? <CircleOff size={14} /> : <Power size={14} />;
}
