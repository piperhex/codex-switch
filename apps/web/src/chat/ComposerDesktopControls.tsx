import { useRef, useState, type KeyboardEvent } from 'react';
import { Popover } from 'antd';
import { Check, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import { ACCESS_OPTIONS } from '../../../../shared/remote-chat/composer';
import { t, useLanguage } from '../i18n';
import { ChatUsage } from './ChatUsage';
import { ComposerContext } from './ComposerContext';
import type { ComposerProps } from './composerProps';

const ACCESS_ICONS = { 'read-only': Hand, 'workspace-write': ShieldCheck, 'danger-full-access': ShieldAlert };

function moveAccessFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'));
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  let next = (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = options.length - 1;
  event.preventDefault();
  options[next]?.focus();
}

export function ComposerAccess({ selection, settingsBusy, updateSettings, beforeOpen }: Pick<ComposerProps,
  'selection' | 'settingsBusy' | 'updateSettings'> & { beforeOpen: () => void }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const selected = ACCESS_OPTIONS.find(option => option.value === selection.access) ?? ACCESS_OPTIONS[1];
  const Icon = ACCESS_ICONS[selected.value];
  const content = <div className="chat-composer-access-menu" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  }}>
    <div className="chat-composer-access-heading">{t('应如何批准操作？')}</div>
    <div role="menu" aria-label={t('访问权限')} onKeyDown={moveAccessFocus}>
      {ACCESS_OPTIONS.map(option => {
        const OptionIcon = ACCESS_ICONS[option.value];
        return <button type="button" role="menuitemradio" key={option.value}
          aria-checked={option.value === selection.access} disabled={settingsBusy}
          className={option.value === 'danger-full-access' ? 'is-full-access' : undefined}
          onClick={() => { void updateSettings({ access: option.value }); close(); }}>
          <OptionIcon size={16} aria-hidden="true" />
          <span><span>{t(option.label)}</span><small>{t(option.description)}</small></span>
          {selection.access === option.value && <Check size={16} aria-hidden="true" />}
        </button>;
      })}
    </div>
  </div>;
  return <Popover trigger="click" placement="topLeft" arrow={false} open={open} content={content}
    onOpenChange={value => { if (value) beforeOpen(); setOpen(value); }}
    styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 12 } }}>
    <button ref={trigger} type="button" className={`chat-composer-access${selected.value === 'danger-full-access'
      ? ' is-full-access' : ''}`} disabled={settingsBusy} aria-haspopup="menu" aria-expanded={open}
      aria-label={t('访问权限：{value1}', { value1: t(selected.label) })}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      <Icon size={16} aria-hidden="true" /><span>{t(selected.label)}</span>
    </button>
  </Popover>;
}

export function ComposerDesktopStatus({ props, beforeOpen }: {
  props: ComposerProps; beforeOpen: () => void;
}) {
  useLanguage();
  return <div className="chat-composer-status">
    <ChatUsage read={props.readUsage} active={props.active} ready={props.ready} inline
      contextControl={<ComposerContext tokenUsage={props.tokenUsage} threadId={props.threadId}
        contextSettings={props.contextSettings} ready={props.ready} beforeOpen={beforeOpen} />} />
  </div>;
}
