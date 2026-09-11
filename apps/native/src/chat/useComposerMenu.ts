import { useEffect, useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import type { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';
import type { TextSelection } from '../../../../shared/remote-chat/client/skillDraft';
import { insertPluginTrigger, nativeComposerTrigger } from './composerTrigger';
import type { Skill } from './types';

interface Options {
  draft: ReturnType<typeof useChatDraft>;
  scope: string;
  active: boolean;
  refresh: () => void;
  compact: () => Promise<boolean>;
}

export function useComposerMenu({ draft, scope, active, refresh, compact }: Options) {
  const input = useRef<TextInput>(null);
  const focusFrame = useRef<number | null>(null);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const range = { start: Math.min(selection.start, draft.text.length),
    end: Math.min(selection.end, draft.text.length) };
  const trigger = nativeComposerTrigger(draft.text, range);
  const triggerKey = trigger ? JSON.stringify(trigger) : '';
  const open = active && (expanded || (!!trigger && triggerKey !== dismissed));
  useEffect(() => { setExpanded(false); setDismissed(triggerKey); }, [scope, active]);
  useEffect(() => { if (!triggerKey) setDismissed(''); }, [triggerKey]);
  useEffect(() => { if (open) refresh(); }, [open, refresh]);
  useEffect(() => () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, [scope, active]);
  const close = () => { setExpanded(false); setDismissed(triggerKey); };
  const openPlugins = () => {
    const next = insertPluginTrigger(draft.text, trigger ?? range);
    draft.setText(next.text); setSelection(next.selection); setDismissed(''); setExpanded(false);
    // Android can leave the input focused after Back hides its keyboard; refocus must cross a frame.
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    input.current?.blur();
    focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; input.current?.focus(); });
  };
  const consumeTrigger = () => {
    if (trigger) {
      draft.removeText(trigger, draft.text);
      setSelection({ start: trigger.start, end: trigger.start });
    }
    close(); input.current?.focus();
  };
  const choose = (skill: Skill) => {
    if (!skill.enabled) return;
    const target = trigger ?? range;
    draft.insertSkill(target, skill);
    close();
    input.current?.focus();
    const prefix = target.start > 0 && !/\s/u.test(draft.text[target.start - 1]) ? 1 : 0;
    const caret = target.start + prefix + skill.name.length + 2;
    setSelection({ start: caret, end: caret });
  };
  const runCompact = async () => {
    const text = draft.text;
    if (!await compact()) return;
    if (trigger) draft.removeText(trigger, text);
    close();
  };
  return { input, selection, setSelection, open, query: trigger?.query ?? '', skillsOnly: trigger?.skillsOnly ?? false,
    plugins: trigger?.plugins ?? false, openPlugins, consumeTrigger,
    choose, close, runCompact, toggle: () => { if (open) close(); else setExpanded(true); } };
}
