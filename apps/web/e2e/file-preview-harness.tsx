import { createRoot } from 'react-dom/client';
import { ChatFilePreview, type FilePreviewContext } from '../src/chat/ChatFilePreview';
import { longMarkdown, markdown } from './file-preview-fixture';
import '../src/styles.css';
import '../src/chat/chat.css';
import '../src/chat/messages.css';

const files: Record<string, string> = {
  'verification.md': markdown, 'README.MARKDOWN': markdown, 'long.md': longMarkdown,
  'empty.md': ' \n', 'source.ts': 'const ready = true;\n',
  'page.HTML': '<h1>页面预览</h1><script>document.body.dataset.ready = "yes";'
    + 'try { parent.previewScriptRan = true } catch {}'
    + 'try { localStorage.setItem("unsafe", "yes") } catch {}'
    + '</script>',
};
const context: FilePreviewContext = {
  threadId: 'file-preview', ready: true,
  load: async (_threadId, path) => {
    if (!(path in files)) throw new Error('File unavailable');
    return { path, text: files[path] };
  },
  client: {
    open: async () => { throw new Error('Downloads are unavailable in this preview fixture'); },
    read: async () => { throw new Error('Downloads are unavailable in this preview fixture'); },
    close: async () => {},
  },
};
const path = new URLSearchParams(location.search).get('path') ?? 'verification.md';
createRoot(document.getElementById('root')!).render(
  <ChatFilePreview path={path} line={3} context={context} onClose={() => {}} />,
);
