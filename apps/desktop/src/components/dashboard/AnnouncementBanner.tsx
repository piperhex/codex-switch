import type { CSSProperties } from "react";
import { Megaphone } from "lucide-react";

interface AnnouncementBannerProps {
  link: string | null;
  onOpenLink: () => void;
  style: CSSProperties | undefined;
  text: string;
  trackKey: string;
  scrollDurationSeconds: number;
}

export function AnnouncementBanner({
  link,
  onOpenLink,
  scrollDurationSeconds,
  style,
  text,
  trackKey,
}: AnnouncementBannerProps) {
  const track = (
    <div className="announcement-track" key={trackKey}
      style={{ animationDuration: `${scrollDurationSeconds}s` }}>
      <div className="announcement-copy">
        <Megaphone size={15} />
        <span>{text}</span>
      </div>
      <div className="announcement-copy" aria-hidden="true">
        <Megaphone size={15} />
        <span>{text}</span>
      </div>
    </div>
  );

  return (
    <div className="announcement-slot" aria-live="polite">
      {link ? (
        <button type="button" className="announcement-marquee announcement-marquee-link"
          title={text} style={style} onClick={onOpenLink}>
          {track}
        </button>
      ) : (
        <div className="announcement-marquee" title={text} style={style}>{track}</div>
      )}
    </div>
  );
}
