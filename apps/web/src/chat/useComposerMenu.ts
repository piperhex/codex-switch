import { useEffect, useRef, useState } from 'react';
import type { useChatDraft } from '../../../../shared/remote-chat/client/useChatDraft';
import type { TextSelection } from '../../../../shared/remote-chat/client/skillDraft';
import { insertPluginTrigger, nativeComposerTrigger } from '../../../../shared/chat/composerTrigger';
import type { Skill } from './types';

interface Options {
  draft: ReturnType<typeof useChatDraft>;
  scope: string;
  active: boolean;
  conversationMentions: boolean;
  refresh: () => void;
  compact: () => Promise<boolean>;
}

export function useComposerMenu({ draft, scope, active, refresh, compact, conversationMentions }: Options) {
  const input = useRef<HTMLTextAreaElement>(null);
  const focusFrame = useRef<number | null>(null);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [expanded, setExpanded] = useState(false);
  const [pickingPlugins, setPickingPlugins] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const range = { start: Math.min(selection.start, draft.text.length),
    end: Math.min(selection.end, draft.text.length) };
  const trigger = nativeComposerTrigger(draft.text, range);
  const triggerKey = trigger ? JSON.stringify(trigger) : '';
  const open = active && (expanded || (!!trigger && triggerKey !== dismissed));
  const conversations = conversationMentions && Boolean(trigger?.plugins) && !pickingPlugins;
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
    if (conversationMentions) { setPickingPlugins(true); setExpanded(true); input.current?.focus(); return; }
    const next = insertPluginTrigger(draft.text, trigger ?? range);
    draft.setText(next.text); setSelection(next.selection); setDismissed(''); setExpanded(false);
    // Restore the caret after React commits the changed draft.
    focusAt(next.selection.start);
  };
  const consumeTrigger = () => {
    if (trigger) {
      draft.removeText(trigger, draft.text);
      setSelection({ start: trigger.start, end: trigger.start });
      focusAt(trigger.start);
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
    focusAt(caret);
  };
  const runCompact = async () => {
    const text = draft.text;
    if (!await compact()) return;
    if (trigger) draft.removeText(trigger, text);
    close();
  };
  return { input, selection, setSelection, open, query: trigger?.query ?? '', skillsOnly: trigger?.skillsOnly ?? false,
    conversations, plugins: pickingPlugins || (Boolean(trigger?.plugins) && !conversations),
    openPlugins, consumeTrigger,
    choose, close, runCompact, restoreCaret, toggle: () => { if (open) close(); else setExpanded(true); } };
}
