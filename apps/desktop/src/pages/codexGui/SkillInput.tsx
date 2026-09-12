import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type KeyboardEvent } from "react";
import type { ComposerText, Skill } from "./types";
import { insertSkill, readEditor, skillTrigger, writeEditor } from "./skillEditorDom";
import { composerOptions, type CompactCommand, type ComposerOption } from "./composerOptions";
import type { SkillTrigger } from "./skillEditorDom";
import { useComposerSkills } from "./useComposerSkills";
import { SkillMenu } from "./SkillMenu";
import styles from "./SkillInput.module.less";

export interface SkillInputHandle { addSkill: (skill: Skill) => void; focus: () => void }

function focusEditor(node: HTMLDivElement, saved: Range | null): Range {
  const range = saved && node.contains(saved.startContainer) && node.contains(saved.endContainer)
    ? saved.cloneRange() : document.createRange();
  if (!node.contains(range.startContainer)) { range.selectNodeContents(node); range.collapse(false); }
  node.focus();
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

export const SkillInput = forwardRef<SkillInputHandle, {
  value: ComposerText; draftKey: string; cwd: string; active: boolean; connected: boolean; disabled: boolean;
  placeholder: string; onChange: (value: ComposerText) => void;
  compact: CompactCommand;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void; onSend: () => void;
  onPasteKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}>(function SkillInput({ value, draftKey, cwd, active, connected, disabled, placeholder,
  compact, onChange, onPaste, onPasteKeyDown, onSend }, ref) {
  const editor = useRef<HTMLDivElement>(null);
  const savedCaret = useRef<Range | null>(null);
  const composing = useRef(false);
  const [trigger, setTrigger] = useState<SkillTrigger | null>(null);
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const open = Boolean(trigger) && active && !disabled;
  const catalog = useComposerSkills({ cwd, active: open, connected });
  const query = trigger?.query.toLocaleLowerCase() ?? "";
  const options = composerOptions(catalog.skills, query, compact);
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));

  useLayoutEffect(() => {
    const node = editor.current;
    if (node && JSON.stringify(readEditor(node)) !== JSON.stringify({ text: value.text, mentions: value.mentions })) {
      writeEditor(node, value);
      savedCaret.current = null;
    }
  }, [value]);
  useLayoutEffect(() => { setTrigger(null); savedCaret.current = null; }, [draftKey, cwd, disabled, active]);

  useImperativeHandle(ref, () => ({ focus: () => {
    if (editor.current && active && !disabled) focusEditor(editor.current, savedCaret.current);
    setTrigger(null);
  }, addSkill: (skill) => {
    const node = editor.current;
    if (!node || disabled || !active || !connected || !skill.enabled) return;
    const range = focusEditor(node, savedCaret.current);
    insertSkill({ query: "", range }, skill);
    onChange(readEditor(node));
    setTrigger(null);
  } }));

  const inspect = () => {
    if (!editor.current || composing.current) return;
    const next = skillTrigger(editor.current);
    setTrigger(next);
    if (next?.query !== trigger?.query) setSelected(0);
  };
  const change = () => {
    if (!editor.current) return;
    onChange(readEditor(editor.current));
    inspect();
  };
  const choose = (option: ComposerOption) => {
    if (!trigger || !editor.current || !option.enabled) return;
    editor.current.focus();
    if (option.kind === "skill") insertSkill(trigger, option.skill);
    else trigger.range.deleteContents();
    change();
    setTrigger(null);
    if (option.kind === "compact") option.command.run();
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !active) return;
    onPasteKeyDown?.(event);
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const menuKey = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key);
    if (open && menuKey && !(event.key === "Enter" && event.shiftKey)) {
      event.preventDefault();
      if (event.key === "Escape") setTrigger(null);
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSelected((selectedIndex + step + options.length) % (options.length || 1));
      } else if (options[selectedIndex]?.enabled) choose(options[selectedIndex]);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) { document.execCommand("insertLineBreak"); change(); }
    else onSend();
  };
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled || !active) { event.preventDefault(); return; }
    onPaste(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    // Plain-text insertion preserves the browser's editing history and strips pasted HTML.
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    change();
  };
  return <div className={styles.inputWrap}>
    {open && <SkillMenu id={listId} options={options} selected={selectedIndex}
      loading={catalog.loading} error={catalog.error} onChoose={choose} />}
    <div ref={editor} role="textbox" aria-label="消息" aria-multiline="true" aria-disabled={disabled}
      aria-autocomplete="list" aria-controls={open ? listId : undefined}
      aria-activedescendant={open && options.length ? `${listId}-${selectedIndex}` : undefined}
      className={styles.editor} contentEditable={!disabled} suppressContentEditableWarning
      data-placeholder={placeholder} data-empty={!value.text} onInput={change} onKeyDown={keyDown}
      onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) inspect(); }}
      onClick={inspect} onBlur={() => {
        const selection = window.getSelection();
        savedCaret.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        setTrigger(null);
      }} onPaste={paste} onDrop={(event) => event.preventDefault()}
      onCompositionStart={() => { composing.current = true; setTrigger(null); }}
      onCompositionEnd={() => { composing.current = false; change(); }} />
  </div>;
});
