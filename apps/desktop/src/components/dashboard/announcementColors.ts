import type { CloudAnnouncement } from "../../types";
import type { ThemeMode } from "../../utils/themeMode";

const DEFAULT_DARK_TEXT_COLOR = "#C4D7C8";
const DEFAULT_DARK_BACKGROUND_COLOR = "#203128";

export function announcementColors(announcement: CloudAnnouncement | null, mode: ThemeMode) {
  if (!announcement) return undefined;
  if (mode === "dark") {
    return {
      color: announcement.darkTextColor ?? DEFAULT_DARK_TEXT_COLOR,
      backgroundColor: announcement.darkBackgroundColor ?? DEFAULT_DARK_BACKGROUND_COLOR,
    };
  }
  return { color: announcement.textColor, backgroundColor: announcement.backgroundColor };
}
