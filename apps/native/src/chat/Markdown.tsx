import { useMemo } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import MarkdownIt from 'markdown-it';
import { palette, styles } from './styles';

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false, maxNesting: 20 });
type Token = ReturnType<typeof parser.parse>[number];
interface Node { token: Token; children: Node[] }
const PREVIEW_LENGTH = 20_000;

function tree(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack = [root];
  for (const token of tokens) {
    if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
    const node: Node = { token, children: token.children ? tree(token.children) : [] };
    stack[stack.length - 1].push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}

function openLink(url: string) {
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
}

function Inline({ nodes }: { nodes: Node[] }) {
  return <>{nodes.map(({ token, children }, index) => {
    if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n';
    if (token.type === 'image') return <Text key={index} style={{ color: palette.green }}
      onPress={() => openLink(String(token.attrGet('src') ?? ''))}>[图片：{token.content || '查看图片'}]</Text>;
    const style = token.type === 'strong_open' ? { fontWeight: '700' as const }
      : token.type === 'em_open' ? { fontStyle: 'italic' as const }
        : token.type === 'code_inline' ? styles.code : undefined;
    if (token.type === 'link_open') return <Text key={index} style={{ color: palette.green }}
      onPress={() => openLink(String(token.attrGet('href') ?? ''))}><Inline nodes={children} /></Text>;
    return <Text key={index} style={style}>{children.length ? <Inline nodes={children} /> : token.content}</Text>;
  })}</>;
}

function Block({ node }: { node: Node }) {
  const { token, children } = node;
  if (token.type === 'fence' || token.type === 'code_block') return <ScrollView horizontal
    style={{ backgroundColor: '#eef3ef', borderRadius: 10, padding: 12, marginVertical: 8 }}>
    <Text selectable style={styles.code}>{token.content.trimEnd()}</Text>
  </ScrollView>;
  if (token.type === 'paragraph_open' || token.type === 'heading_open' || token.type === 'inline') {
    const inline = token.type === 'inline' ? children : children.flatMap((child) => child.children);
    return <Text selectable style={[styles.messageText, { marginVertical: 6 },
      token.type === 'heading_open' && { fontWeight: '700', fontSize: 19 }]}><Inline nodes={inline} /></Text>;
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') return <View>
    {children.map((child, index) => <View key={index} style={[styles.row, { alignItems: 'flex-start' }]}>
      <Text style={[styles.messageText, { paddingTop: 6 }]}>{token.type === 'ordered_list_open'
        ? `${Number(token.attrGet('start') ?? 1) + index}.` : '•'}</Text>
      <View style={styles.fill}><Block node={child} /></View>
    </View>)}
  </View>;
  if (token.type === 'table_open') return <ScrollView horizontal><View>
    {children.map((child, index) => <Block key={index} node={child} />)}
  </View></ScrollView>;
  if (token.type === 'tr_open') return <View style={{ flexDirection: 'row' }}>
    {children.map((child, index) => <View key={index} style={{ width: 160, padding: 8,
      borderWidth: 0.5, borderColor: palette.border }}><Block node={child} /></View>)}
  </View>;
  if (token.type === 'hr') return <View style={{ height: 1, backgroundColor: palette.border, marginVertical: 10 }} />;
  return <View style={token.type === 'blockquote_open' ? styles.tool : undefined}>
    {children.map((child, index) => <Block key={index} node={child} />)}
  </View>;
}

export function ChatMarkdown({ text }: { text: string }) {
  const nodes = useMemo(() => tree(parser.parse(text.slice(0, PREVIEW_LENGTH), {})), [text]);
  return <View>{nodes.map((node, index) => <Block key={index} node={node} />)}
    {text.length > PREVIEW_LENGTH && <RemainingText text={text.slice(PREVIEW_LENGTH)} />}
  </View>;
}

function RemainingText({ text }: { text: string }) {
  // Large outputs stay readable and copyable without constructing tens of thousands of formatted native views.
  return <Pressable accessibilityRole="text"><Text selectable style={styles.messageText}>{text}</Text></Pressable>;
}
