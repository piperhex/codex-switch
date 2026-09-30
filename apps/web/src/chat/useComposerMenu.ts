import { useEffect, useRef, useState } from 'react';
import type { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';
import type { TextSelection } from '../../../../shared/remote-chat/client/skillDraft';
import { composerMenuTrigger } from '../../../../shared/chat/composerTrigger';
import type { Skill } from './types';

interface Options {
  draft: ReturnType<typeof useChatDraft>;
  scope: string;
  active: boolean;
  refresh: () => void;
  compact: () => Promise<boolean>;
}

export function useComposerMenu({ draft, scope, active, refresh, compact }: Options) {
  const input = useRef<HTMLTextAreaElement>(null);
  const focusFrame = useRef<number | null>(null);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [expanded, setExpanded] = useState(false);
  const [pickingPlugins, setPickingPlugins] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const range = { start: Math.min(selection.start, draft.text.length),
    end: Math.min(selection.end, draft.text.length) };
  const trigger = composerMenuTrigger(draft.text, range);
  const triggerKey = trigger ? JSON.stringify(trigger) : '';
  const open = active && (expanded || (!!trigger && triggerKey !== dismissed));
  const conversations = Boolean(trigger?.conversations) && !pickingPlugins;
  useEffect(() => { setExpanded(false); setPickingPlugins(false); setDismissed(triggerKey); }, [scope, active]);
  useEffect(() => { if (!triggerKey) setDismissed(''); }, [triggerKey]);
  useEffect(() => { if (open && !conversations) refresh(); }, [open, conversations, refresh]);
  useEffect(() => () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, [scope, active]);
  const focusAt = (caret: number) => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null; input.current?.focus(); input.current?.setSelectionRange(caret, caret);
    });
  };
  const close = () => { setExpanded(false); setPickingPlugins(false); setDismissed(triggerKey); };
  const restoreCaret = (caret: number) => {
    setSelection({ start: caret, end: caret }); focusAt(caret);
  };
  const openPlugins = () => {
    setPickingPlugins(true); setExpanded(true); input.current?.focus();
  };
  const consumeTrigger = () => {
    if (trigger && !pickingPlugins) {
      draft.removeText(trigger, draft.text);
      setSelection({ start: trigger.start, end: trigger.start });
      focusAt(trigger.start);
    }
    close(); input.current?.focus();
  };
  const choose = (skill: Skill) => {
    if (!skill.enabled) return;
    const target = pickingPlugins ? range : trigger ?? range;
    draft.insertSkill(target, skill);
    close();
    input.current?.focus();
    const prefix = target.start > 0 && !/\s/u.test(draft.text[target.start - 1]) ? 1 : 0;
    const caret = target.start + prefix + skill.name.length + 2;
    setSelection({ start: caret, end: caret });
    focusAt(caret);
  };
  const runCompact = async () => {
    const text = draft.text;
    if (!await compact()) return;
    if (trigger) draft.removeText(trigger, text);
    close();
  };
  return { input, selection, setSelection, open, query: pickingPlugins ? '' : trigger?.query ?? '',
    skillsOnly: trigger?.skillsOnly ?? false, conversations, plugins: pickingPlugins,
    openPlugins, consumeTrigger,
    choose, close, runCompact, restoreCaret, toggle: () => { if (open) close(); else setExpanded(true); } };
}
