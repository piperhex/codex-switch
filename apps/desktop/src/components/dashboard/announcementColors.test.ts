import { describe, expect, it } from "vitest";
import type { CloudAnnouncement } from "../../types";
import { announcementColors } from "./announcementColors";

const announcement: CloudAnnouncement = {
  content: "通知", contentZh: "通知", contentEn: "Notice", enabled: true, link: "",
  textColor: "#008271", backgroundColor: "#CEFDEE", scrollDurationSeconds: 22,
  darkTextColor: "#ABCDEF", darkBackgroundColor: "#123456",
};

describe("announcement colors", () => {
  it("selects the configured palette when the theme changes", () => {
    expect(announcementColors(announcement, "light"))
      .toEqual({ color: "#008271", backgroundColor: "#CEFDEE" });
    expect(announcementColors(announcement, "dark"))
      .toEqual({ color: "#ABCDEF", backgroundColor: "#123456" });
    expect(announcementColors(announcement, "light"))
      .toEqual({ color: "#008271", backgroundColor: "#CEFDEE" });
  });

  it("uses readable dark defaults for legacy server responses", () => {
    expect(announcementColors({ ...announcement, darkTextColor: undefined, darkBackgroundColor: null }, "dark"))
      .toEqual({ color: "#C4D7C8", backgroundColor: "#203128" });
  });

  it("preserves built-in welcome styles when no announcement is published", () => {
    expect(announcementColors(null, "light")).toBeUndefined();
    expect(announcementColors(null, "dark")).toBeUndefined();
  });
});
