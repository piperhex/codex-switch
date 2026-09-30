import { Badge } from "antd";
import { Download } from "lucide-react";

export function CliUpdateIcon({ version, release }: {
  version: string | null; release: { version: string } | null;
}) {
  const available = Boolean(version && release && release.version !== version);
  return <Badge dot={available} offset={[1, 0]} styles={{ root: { display: "inline-flex" } }}
    title={available ? "有新版本" : undefined}>
    <Download size={16} />
  </Badge>;
}
