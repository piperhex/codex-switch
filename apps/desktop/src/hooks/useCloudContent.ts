import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCloudAnnouncement,
  fetchCloudFaqs,
  fetchCloudNotifications,
} from "../api/backend";
import type { CloudAnnouncement, CloudFaq, CloudNotification } from "../types";

const ANNOUNCEMENT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const LAST_NOTIFICATION_SEEN_KEY = "codex-switch:last-notification-seen-at";

function hasLocalizedAnnouncementContent(announcement: CloudAnnouncement) {
  const hasChineseContent = announcement.contentZh?.trim() || announcement.content?.trim();
  const hasEnglishContent = announcement.contentEn?.trim() || announcement.content?.trim();
  return Boolean(hasChineseContent && hasEnglishContent);
}

export function useCloudContent() {
  const [announcement, setAnnouncement] = useState<CloudAnnouncement | null>(null);
  const [notifications, setNotifications] = useState<CloudNotification[]>([]);
  const [faqs, setFaqs] = useState<CloudFaq[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [lastNotificationSeenAt, setLastNotificationSeenAt] = useState(
    () => window.localStorage.getItem(LAST_NOTIFICATION_SEEN_KEY),
  );
  const announcementRequestId = useRef(0);
  const notificationRequestId = useRef(0);
  const faqRequestId = useRef(0);

  const loadAnnouncement = useCallback(async () => {
    const requestId = ++announcementRequestId.current;
    try {
      const result = await fetchCloudAnnouncement();
      if (announcementRequestId.current !== requestId) return;
      setAnnouncement(result.enabled && hasLocalizedAnnouncementContent(result) ? result : null);
    } catch {
      if (announcementRequestId.current === requestId) setAnnouncement(null);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationRequestId.current;
    try {
      const result = await fetchCloudNotifications();
      if (notificationRequestId.current === requestId) setNotifications(result);
    } catch {
      // Keep the last successful result during a transient server failure.
    }
  }, []);

  const loadFaqs = useCallback(async () => {
    const requestId = ++faqRequestId.current;
    try {
      const result = await fetchCloudFaqs();
      if (faqRequestId.current === requestId) setFaqs(result);
    } catch {
      // Keep the last successful result during a transient server failure.
    }
  }, []);

  const markNotificationsSeen = useCallback(() => {
    const seenAt = new Date().toISOString();
    window.localStorage.setItem(LAST_NOTIFICATION_SEEN_KEY, seenAt);
    setLastNotificationSeenAt(seenAt);
  }, []);

  return {
    announcement,
    faqs,
    lastNotificationSeenAt,
    loadAnnouncement,
    loadFaqs,
    loadNotifications,
    markNotificationsSeen,
    notifications,
    notificationsOpen,
    setAnnouncement,
    setFaqs,
    setNotifications,
    setNotificationsOpen,
    announcementRequestId,
    notificationRequestId,
    faqRequestId,
  };
}

type CloudContent = ReturnType<typeof useCloudContent>;

export function useCloudContentLifecycle(
  cloudContent: CloudContent,
  cloudBaseUrl: string | null | undefined,
) {
  const {
    announcementRequestId,
    faqRequestId,
    loadAnnouncement,
    loadFaqs,
    loadNotifications,
    notificationRequestId,
    setAnnouncement,
    setFaqs,
    setNotifications,
  } = cloudContent;
  useEffect(() => {
    setAnnouncement(null);
    setNotifications([]);
    setFaqs([]);
    void loadAnnouncement();
    void loadNotifications();
    void loadFaqs();
    const timer = window.setInterval(() => void loadAnnouncement(), ANNOUNCEMENT_REFRESH_INTERVAL_MS);
    return () => {
      announcementRequestId.current += 1;
      notificationRequestId.current += 1;
      faqRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [cloudBaseUrl, loadAnnouncement, loadFaqs, loadNotifications]);
}
