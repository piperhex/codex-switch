import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Text } from 'react-native';
import type { FileReference } from '../../../../shared/chat/fileReference';
import { localImageSource } from '../../../../shared/chat/imageSources';
import { isMarkdownPath, type TextPreview } from '../../../../shared/remote-chat/textPreview';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView } from '../components/SheetScrollView';
import { ChatCodeBlock } from './ChatCodeBlock';
import { ChatImageFilePreview } from './ChatImageFilePreview';
import { ChatHtmlPreview, isHtmlPath } from './ChatHtmlPreview';
import { ChatMarkdownPreview } from './ChatMarkdownPreview';
import { fileLanguage } from './ChatCodeHighlight';
import { styles } from './styles';

import { isVideoPath, type VideoClient } from '../../../../shared/remote-chat/video';
import { VideoViewer } from './video/VideoViewer';
import type { FileClient } from '../../../../shared/remote-chat/fileDownload';
import { useManagedDownload } from '../downloads/useManagedDownload';

const BINARY_FILE = /\.(?:exe|apk|aab|msi|zip|7z|rar|gz|tar|dmg|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|mp3|wav)$/i;

export const ChatFileContext = createContext<((file: FileReference) => void) | null>(null);
interface Props {
  threadId: string | null;
  ready: boolean;
  load: (threadId: string, path: string) => Promise<TextPreview>;
  children: ReactNode;
  videos: VideoClient;
  files: FileClient;
}

type PreviewProps = Omit<Props, 'children'> & {
  file: FileReference; close: () => void;
};

function FilePreview({ file, threadId, ready, load, files, close }: PreviewProps) {
  const [result, setResult] = useState<TextPreview>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const binary = BINARY_FILE.test(file.path);
  const html = isHtmlPath(file.path);
  const markdown = isMarkdownPath(file.path);
  const download = useManagedDownload({ client: files, threadId, ready, path: file.path });
  useEffect(() => {
    if (!threadId || !ready || binary) return;
    let cancelled = false;
    setError(''); setResult(undefined);
    void load(threadId, file.path).then((value) => { if (!cancelled) setResult(value); }, () => {
      if (!cancelled) setError('暂时无法预览，可以下载后打开。');
    });
    return () => { cancelled = true; };
  }, [threadId, ready, load, file.path, attempt, binary]);
  return <BottomSheet fullWidthContent visible tall title="文件" subtitle={file.path} onClose={close} dragFromHeaderOnly
    actions={[{ label: download.label, onPress: download.busy ? download.cancel : download.start,
      tone: 'primary', disabled: !download.busy && !download.completed && (!ready || !threadId) },
    ...(error ? [{ label: '重新预览', onPress: () => setAttempt(attempt + 1), disabled: !ready }] : [])]}>
    <SheetScrollView style={{ flexShrink: 1 }}
      contentContainerStyle={{ paddingBottom: result && (html || markdown) ? 0 : 20 }}>
      {!ready && !result && <Text style={styles.subtitle}>请连接电脑后查看文件。</Text>}
      {binary && <Text style={styles.subtitle}>下载后即可用相应的应用打开。</Text>}
      {ready && !binary && !result && !error && <ActivityIndicator accessibilityLabel="正在读取文件" />}
      {download.busy && !!download.detail && <Text style={[styles.subtitle, { maxWidth: 400 }]}>
        {download.detail}</Text>}
      {!!download.message && <Text accessibilityLiveRegion="polite" style={[styles.subtitle,
        { maxWidth: 400 }]}>{download.message}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {result && !html && !markdown && <>
        <Text style={styles.subtitle}>当前文件内容{file.line ? ` · 引用第 ${file.line} 行` : ''}</Text>
        <ChatCodeBlock text={result.text} label="完整文本" language={fileLanguage(file.path)}
          lineNumbers copyLabel="复制文件内容" />
      </>}
    </SheetScrollView>
    {result && html && <ChatHtmlPreview text={result.text} />}
    {result && markdown && <ChatMarkdownPreview text={result.text} line={file.line} />}
  </BottomSheet>;
}

function FilePreviewContent(props: PreviewProps) {
  const { file, threadId, ready, videos, files, close } = props;
  if (localImageSource(file.path)) return <ChatImageFilePreview path={file.path} close={close} />;
  if (isVideoPath(file.path)) return <VideoViewer path={file.path} threadId={threadId}
    ready={ready} client={videos} files={files} close={close} />;
  return <FilePreview {...props} />;
}

export function ChatFileProvider({ children, ...options }: Props) {
  const [file, setFile] = useState<FileReference | null>(null);
  const open = useCallback((value: FileReference) => { Keyboard.dismiss(); setFile(value); }, []);
  return <ChatFileContext.Provider value={open}>
    {children}
    {file && <FilePreviewContent key={file.path} {...options} file={file} close={() => setFile(null)} />}
  </ChatFileContext.Provider>;
}
