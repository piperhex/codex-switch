import { guiText } from "../../i18n/guiText";
import { CopyButton } from "./CopyButton";
import { RichText } from "./RichText";
import { OUTPUT_BATCH_CHARACTERS, useProgressiveToolText } from "./useProgressiveToolText";
import styles from "./ActivityRow.module.less";

/** Load long tool output progressively while keeping it one continuous document. */
export function ToolText({ text, markdown = false, className }: {
  text: string; markdown?: boolean; className?: string;
}) {
  const { viewport, loadNearEnd, visible } = useProgressiveToolText(text);
  return <>
    <div ref={viewport} className={styles.textViewport} onScroll={loadNearEnd}
      tabIndex={0} role="region" aria-label={guiText("工具内容")}>
      {markdown ? <RichText text={visible} /> : <pre className={className}>{visible}</pre>}
    </div>
    {text.length > OUTPUT_BATCH_CHARACTERS && <div className={styles.outputActions}>
      <CopyButton text={text} label={guiText("复制完整内容")} />
    </div>}
  </>;
}
