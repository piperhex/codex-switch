import { useCallback, useEffect, useState } from "react";
import { loadAppSettings, updateHideAccountNotes, updatePrivacyMode } from "../api/backend";

export function usePrivacyMode(notify: (message: string) => void) {
  const [enabled, setEnabled] = useState(true);
  const [hideAccountNotes, setHideAccountNotes] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (active) {
          setEnabled(settings.privacyMode);
          setHideAccountNotes(settings.hideAccountNotes);
        }
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    setLoading(true);
    try {
      const settings = await updatePrivacyMode(nextEnabled);
      setEnabled(settings.privacyMode);
    } catch (error) {
      setEnabled(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, notify]);

  const updateNotesHidden = useCallback(async (nextEnabled: boolean) => {
    const previous = hideAccountNotes;
    setHideAccountNotes(nextEnabled);
    setLoading(true);
    try {
      const settings = await updateHideAccountNotes(nextEnabled);
      setHideAccountNotes(settings.hideAccountNotes);
    } catch (error) {
      setHideAccountNotes(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [hideAccountNotes, notify]);

  return {
    enabled,
    hideAccountNotes,
    loading,
    setEnabled: updateEnabled,
    setHideAccountNotes: updateNotesHidden,
  };
}
