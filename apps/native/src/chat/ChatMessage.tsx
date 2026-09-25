import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatMarkdown } from './Markdown';
import { ChatImage } from './ChatImage';
import { ChatActivityLabel } from './ChatActivityLabel';
import { QuoteSourceContext } from './ChatQuotes';
import { UserMessageText } from './UserMessageText';
import { questionMessageText } from '../../../../shared/remote-chat/client/asyncQuestions';
import { messageContent, messageLabel } from '../../../../shared/chat/messageDetails';
import { itemImageSources } from '../../../../shared/chat/imageSources';
import { commandPreview } from '../../../../shared/chat/commandPreview';
import {
  collaborationSummary, isCollaborationActivity,
} from '../../../desktop/src/pages/codexGui/collaborationActivity';
import { formatTurnDuration } from '../../../desktop/src/pages/codexGui/turnTiming';
import type { Item } from './types';
import { palette, styles } from './styles';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const PREVIEW_LENGTH = 160;
const STATUS_LABELS: Record<string, string> = {
  inProgress: '进行中', completed: '已完成', failed: '失败', declined: '已拒绝', interrupted: '已停止',
};
const ACTIVITIES: Record<string, { label: string; icon: IconName }> = {
  fileChange: { label: '文件修改', icon: 'document-text-outline' },
  mcpToolCall: { label: '调用工具', icon: 'construct-outline' },
  dynamicToolCall: { label: '调用工具', icon: 'construct-outline' },
  webSearch: { label: '搜索网页', icon: 'search-outline' },
  contextCompaction: { label: '已整理对话上下文', icon: 'list-outline' },
  imageView: { label: '查看图片', icon: 'image-outline' },
  imageGeneration: { label: '生成图片', icon: 'sparkles-outline' },
  plan: { label: '计划', icon: 'list-outline' },
  enteredReviewMode: { label: '开始代码审查', icon: 'document-text-outline' },
  exitedReviewMode: { label: '代码审查结果', icon: 'document-text-outline' },
  functionCallOutput: { label: '工具输出', icon: 'construct-outline' },
  hookPrompt: { label: '任务补充', icon: 'list-outline' },
};

function commandSummary(item: Item) {
  const action = item.commandActions?.find((entry) => entry.type !== 'unknown');
  const labels: Record<string, string> = { read: '读取文件', listFiles: '浏览文件', search: '搜索代码' };
  if (action) return `${labels[action.type] || '执行命令'} · ${action.name || action.query || action.path || ''}`;
  const status: Record<string, string> = {
    inProgress: '正在运行', completed: '已运行', failed: '运行失败', declined: '已拒绝',
  };
  return `${status[item.status ?? ''] || '执行命令'} ${commandPreview(item.command ?? '')}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function activityContent(item: Item) {
  if (item.type === 'fileChange') return item.changes?.map((change) => fileName(change.path)).join('、');
  if (item.type === 'imageView' || item.type === 'imageGeneration') {
    const path = item.savedPath || item.path;
    if (path) return fileName(path);
  }
  return item.query || item.tool || item.review || item.text || item.path;
}

function activitySummary(item: Item): { preview: string; icon: IconName } {
  if (isCollaborationActivity(item)) return { preview: collaborationSummary(item), icon: 'people-outline' };
  if (item.type === 'commandExecution') return { preview: commandSummary(item), icon: 'terminal-outline' };
  if (item.type === 'reasoning') return { icon: 'bulb-outline', preview: [...item.summary ?? [], messageContent(item)]
    .join('\n').slice(0, PREVIEW_LENGTH).trim().split('\n')[0].replace(/[*_`#]/g, '') };
  if (item.type === 'sleep') return { icon: 'time-outline',
    preview: `等待${item.durationMs == null ? '' : ` · ${formatTurnDuration(item.durationMs)}`}` };
  if (item.type === 'webSearch' && item.action?.type === 'openPage') return { icon: 'search-outline',
    preview: `阅读网页 · ${item.action.url ?? item.query ?? ''}` };
  const { label, icon } = ACTIVITIES[item.type] ?? { label: messageLabel(item), icon: 'pulse-outline' };
  const content = activityContent(item);
  return { icon, preview: [label, content, STATUS_LABELS[item.status ?? '']].filter(Boolean).join(' · ') };
}

export function ChatActivityRow({ item, onOpen, running = false, count }: {
  item: Item; onOpen: (id: string) => void; running?: boolean; count?: number;
}) {
  const summary = activitySummary(item);
  if (item.type === 'reasoning' && !summary.preview.trim()) return null;
  const preview = summary.preview.slice(0, PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
  const label = count ? `${preview}，查看全部 ${count} 项活动` : preview;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    style={messageStyles.activity} onPress={() => onOpen(item.id)}>
    <ChatActivityLabel icon={summary.icon} text={preview} active={running && item.status === 'inProgress'} />
    <Ionicons name="chevron-forward" size={15} color={palette.muted} />
  </Pressable>;
}

interface MessageProps {
  item: Item; onOpen: (id: string) => void; running?: boolean; process?: boolean; onQuote?: () => void;
}

export const ChatMessage = memo(function ChatMessage(props: MessageProps) {
  return <QuoteSourceContext.Provider value={{ messageId: props.item.id, onQuote: props.onQuote,
    role: props.item.type === 'userMessage' ? 'user' : 'assistant' }}>
    <MessageBody {...props} />
  </QuoteSourceContext.Provider>;
});

function MessageBody({ item, onOpen, running = false, process = false }: MessageProps) {
  const images = itemImageSources(item);
  const text = questionMessageText(item);
  if (item.type === 'userMessage') return <View style={messageStyles.user}>
    <View
      style={[styles.userMessage, messageStyles.bubble, images.length > 0 && messageStyles.imageBubble]}>
      {!!text && <UserMessageText text={text} />}
      {images.map((source, index) => <ChatImage key={index} source={source} />)}
    </View>
  </View>;
  if (item.type !== 'agentMessage') return <ChatActivityRow item={item} onOpen={onOpen} running={running} />;
  return <View style={styles.assistantMessage}>
    <ChatMarkdown text={text} tone={process ? 'process' : 'default'}
      copy={!process && !running && text.trim() ? { text, label: '复制回复' } : undefined} />
  </View>;
}

const messageStyles = StyleSheet.create({
  activity: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  user: { alignItems: 'flex-end' },
  bubble: { borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 19, paddingVertical: 15 },
  imageBubble: { width: '92%' },
});
