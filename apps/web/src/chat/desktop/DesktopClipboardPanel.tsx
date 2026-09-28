import { useRef } from 'react';
import { t } from '../../i18n';
import type { useDesktopClipboard } from './useDesktopClipboard';
import { downloadClipboardFile } from './clipboardContent';

export function DesktopClipboardPanel({ clipboard }: { clipboard: ReturnType<typeof useDesktopClipboard> }) {
  const files = useRef<HTMLInputElement>(null);
  const received = clipboard.received;
  return <aside className="rd-settings rd-clipboard" aria-label={t('剪贴板')}>
    <header>{t('剪贴板')}<button onClick={() => clipboard.setOpen(false)}>{t('完成')}</button></header>
    <p>{t(clipboard.nativeFiles ? '复制后，在另一台电脑上粘贴即可。支持文本、图片和文件。'
      : '在桌面中使用 Ctrl+C、Ctrl+X 和 Ctrl+V，复制粘贴文本、图片和文件。')}</p>
    <div className="rd-options">
      <button disabled={clipboard.busy} onClick={clipboard.pasteLocal}>{t('粘贴到远程')}</button>
      <button disabled={clipboard.busy} onClick={() => clipboard.copy()}>{t('获取远程剪贴板')}</button>
      <button disabled={clipboard.busy} onClick={() => files.current?.click()}>{t('发送文件')}</button>
      <input ref={files} type="file" multiple hidden aria-label={t('选择发送的文件')}
        onChange={event => { clipboard.sendFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    </div>
    <small>{t(clipboard.nativeFiles ? '每次最多 64 MB、32 个文件，文件夹请先压缩。'
      : '每次最多 64 MB、32 个文件。远程文件会下载到本机；文件夹请先压缩。')}</small>
    {clipboard.status && <p role="status">{t(clipboard.status)}
      {clipboard.progress !== undefined && ` ${clipboard.progress}%`}</p>}
    {received?.format === 'text' && <textarea readOnly value={received.text} aria-label={t('远程剪贴板文本')} />}
    {received?.format === 'image' && <img alt={t('远程剪贴板图片')} src={`data:image/png;base64,${received.data}`} />}
    {received && (received.format !== 'files' || clipboard.nativeFiles)
      && <button disabled={clipboard.busy} onClick={clipboard.save}>
      {t('复制到本机')}</button>}
    {received?.format === 'files' && !clipboard.nativeFiles
      && <div className="rd-clipboard-files">{received.files.map((file, index) =>
      <button key={`${index}:${file.name}`} onClick={() => downloadClipboardFile(file)}>{t('下载')} {file.name}</button>)}</div>}
  </aside>;
}
