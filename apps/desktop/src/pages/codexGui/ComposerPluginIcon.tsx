import { useState } from "react";
import { Blocks, FileText, Globe, LayoutTemplate, Presentation, Sheet } from "lucide-react";
import type { ComposerPlugin } from "./attachmentTypes";

const ICONS = [
  { match: /document/i, Icon: FileText, color: "#428bea" },
  { match: /pdf/i, Icon: FileText, color: "#db6279" },
  { match: /spreadsheet/i, Icon: Sheet, color: "#599467" },
  { match: /presentation/i, Icon: Presentation, color: "#d7ad52" },
  { match: /template/i, Icon: LayoutTemplate, color: "#50a2d7" },
  { match: /browser/i, Icon: Globe, color: "#439cea" },
];

export function ComposerPluginIcon({ plugin }: { plugin: ComposerPlugin }) {
  const [failed, setFailed] = useState(false);
  const url = plugin.interface?.composerIconUrl;
  if (!failed && url?.startsWith("https://")) return <img src={url} width={19} height={19} alt=""
    referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ flexShrink: 0, objectFit: "contain" }} />;
  const { Icon, color } = ICONS.find((entry) => entry.match.test(plugin.name)) ?? { Icon: Blocks, color: "#579aaa" };
  return <Icon size={19} style={{ color }} aria-hidden="true" />;
}
