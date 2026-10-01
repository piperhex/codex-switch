import { ImageViewer } from "../../../../../shared/chat/ImageViewer";
import { useImageMenu } from "./useImageMenu";
import styles from "./ImagePreview.module.less";

interface Props {
  thumbnail: string;
  description: string;
  load: () => Promise<string>;
  close: () => void;
}

export function ImagePreview(props: Props) {
  const menu = useImageMenu();
  return <span className={styles.preview}><ImageViewer {...props} {...menu} translate={guiText} /></span>;
}
import { guiText } from "../../i18n/guiText";
