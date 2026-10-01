import { guiText } from "../../i18n/guiText";
import { useEffect, useState } from "react";
import type { BubbleResetDisplay } from "../../types";
import type { Language } from "../../i18n";
import { resetClockTime } from "../../utils/format";

export function BubbleResetLabel({ timestamp, language, display, className, compact = false }: {
  timestamp?: number | null;
  language: Language;
  display: BubbleResetDisplay;
  className?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timestamp || display !== "countdown") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [display, timestamp]);

  if (display === "resetAt") {
    const clock = resetClockTime(timestamp);
    if (compact) {
      return (
        <small className={`floating-bubble-reset ${className ?? ""}`}>
          <span>{clock ?? ((language === "ru" ? guiText("未知", {}, language) : language === "zh" ? "未知" : "unknown"))}</span>
        </small>
      );
    }
    return (
      <small className={`floating-bubble-reset floating-bubble-reset-stacked ${className ?? ""}`}>
        <span>{(language === "ru" ? (clock ? guiText("重置于", {}, language) : guiText("重置时间", {}, language)) : language === "zh" ? (clock ? "重置于" : "重置时间") : (clock ? "Resets at" : "Reset time"))}</span>
        <span>{clock ?? ((language === "ru" ? guiText("未知", {}, language) : language === "zh" ? "未知" : "unknown"))}</span>
      </small>
    );
  }

  const totalSeconds = timestamp ? Math.max(0, Math.ceil((timestamp * 1000 - now) / 1000)) : null;
  const days = totalSeconds === null ? null : Math.floor(totalSeconds / 86_400);
  const hours = totalSeconds === null ? null : Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = totalSeconds === null ? null : Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds === null ? null : totalSeconds % 60;
  const time = hours === null || minutes === null || seconds === null
    ? null
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (compact) {
    return (
      <small className={`floating-bubble-reset ${className ?? ""}`}>
        <span>{time ? `${days}${(language === "ru" ? guiText("天", {}, language) : language === "zh" ? "天" : "d")}\u00a0${time}` : "--"}</span>
      </small>
    );
  }
  return (
    <small className={`floating-bubble-reset floating-bubble-reset-stacked ${className ?? ""}`}>
      {time ? <><span>{days}{(language === "ru" ? guiText("天", {}, language) : language === "zh" ? "天" : "d")}</span><span>{time}</span></> : <span>--</span>}
    </small>
  );
}
