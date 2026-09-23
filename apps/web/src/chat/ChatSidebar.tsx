import { t, useLanguage } from '../i18n';
import type { ReactNode } from 'react';
import { Drawer } from 'antd';
import { X } from 'lucide-react';

export function ChatSidebar({ desktop, open, onClose, children, customHeading = false }: {
  desktop: boolean; open: boolean; onClose: () => void; children: ReactNode;
  customHeading?: boolean;
}) {
  useLanguage();
  if (desktop) return open && <aside className="chat-sidebar" aria-label={t("聊天列表")}>
    {!customHeading && <header className="chat-sidebar-heading"><strong>{t("聊天")}</strong></header>}
    {children}
  </aside>;
  return <Drawer open={open} placement="left" width="min(360px, 88vw)" rootClassName="chat-drawer"
    title={t("聊天")} destroyOnClose onClose={onClose} closeIcon={<X size={20} aria-label={t("收起聊天列表")} />}>
    {children}
  </Drawer>;
}
