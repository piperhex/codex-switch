import { createContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import type { FileReference } from '../../../../shared/chat/fileReference';
import type { TextPreview } from '../../../../shared/remote-chat/textPreview';
import { BottomSheet } from '../components/BottomSheet';
import { ChatCodeBlock } from './ChatCodeBlock';
import { styles } from './styles';

export const ChatFileContext = createContext<((file: FileReference) => void) | null>(null);
interface Props {
  threadId: string | null;
  ready: boolean;
  load: (threadId: string, path: string) => Promise<TextPreview>;
  children: ReactNode;
}

function FilePreview({ file, threadId, ready, load, close }: Omit<Props, 'children'> & {
  file: FileReference; close: () => void;
}) {
  const [result, setResult] = useState<TextPreview>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!threadId || !ready) return;
    let cancelled = false;
    setError(''); setResult(undefined);
    void load(threadId, file.path).then((value) => { if (!cancelled) setResult(value); }, () => {
      if (!cancelled) setError('文件暂时无法读取，请确认文件仍在当前项目中，且为不超过 2 MB 的文本文件。');
    });
    return () => { cancelled = true; };
  }, [threadId, ready, load, file.path, attempt]);
  return <BottomSheet visible tall title="文件内容" subtitle={file.path} onClose={close} dragFromHeaderOnly
    actions={error ? [{ label: '重试', onPress: () => setAttempt(attempt + 1), disabled: !ready }] : []}>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
      {!ready && !result && <Text style={styles.subtitle}>请连接电脑后查看文件。</Text>}
      {ready && !result && !error && <ActivityIndicator accessibilityLabel="正在读取文件" />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {result && <>
        <Text style={styles.subtitle}>当前文件内容{file.line ? ` · 引用第 ${file.line} 行` : ''}</Text>
        <ChatCodeBlock text={result.text} label="完整文本" lineNumbers />
      </>}
    </ScrollView>
  </BottomSheet>;
}

export function ChatFileProvider({ children, ...options }: Props) {
  const [file, setFile] = useState<FileReference | null>(null);
  return <ChatFileContext.Provider value={setFile}>
    {children}
    {file && <FilePreview key={file.path} {...options} file={file} close={() => setFile(null)} />}
  </ChatFileContext.Provider>;
}
