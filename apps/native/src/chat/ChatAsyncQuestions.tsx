import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import { pendingQuestions } from '../../../../shared/remote-chat/client/asyncQuestions';
import type { Item, Thread } from './types';
import { palette, styles } from './styles';

interface Props {
  thread: Thread | null; disabled: boolean; error: string;
  answer: (item: Item, answers: string[]) => Promise<boolean>;
}
interface QuestionProps {
  question: NonNullable<Item['questions']>[number]; value: string; disabled: boolean;
  update: (value: string) => void; submit: () => void;
}

function QuestionField({ question, value, disabled, update, submit }: QuestionProps) {
  return <View style={questionStyles.question}>
    <Text style={styles.messageText}>{question.title}</Text>
    {question.options?.map((option, index) => <Pressable key={index} accessibilityRole="radio"
      disabled={disabled} accessibilityState={{ checked: value === option, disabled }}
      style={questionStyles.option} onPress={() => update(option)}>
      <Ionicons name={value === option ? 'radio-button-on' : 'radio-button-off'} size={18}
        color={value === option ? palette.green : palette.muted} />
      <Text style={[styles.messageText, styles.fill]}>{option}</Text>
    </Pressable>)}
    <TextInput accessibilityLabel={question.title} placeholder="输入你的回答" placeholderTextColor={palette.muted}
      style={[styles.questionInput, questionStyles.input, disabled && styles.disabled]}
      multiline editable={!disabled} value={value} onChangeText={update} returnKeyType="send"
      submitBehavior="submit" onSubmitEditing={submit} />
  </View>;
}

function QuestionCard({ item, disabled, error, answer, onCancel }: Omit<Props, 'thread'> & {
  item: Item; onCancel: () => void;
}) {
  const questions = item.questions ?? [];
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState(() => questions.map((question) => question.options?.[0] ?? ''));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const submitting = useRef(false);
  const cancel = () => {
    if (submitting.current) return;
    setOpen(false);
    onCancel();
  };
  const submit = async () => {
    if (submitting.current || disabled || answers.some((value) => !value.trim())) return;
    submitting.current = true; setBusy(true); setFailure('');
    try {
      if (await answer(item, answers)) setOpen(false);
      else setFailure('回答尚未确认，请查看发送进度或稍后重试。');
    } catch { setFailure('回答发送失败，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`回答补充问题：${questions[0]?.title ?? ''}`}
      style={questionStyles.entry} onPress={() => setOpen(true)}>
      <Ionicons name="chatbubble-ellipses-outline" size={18} color={palette.green} />
      <View style={styles.fill}><Text style={styles.title}>需要你的补充</Text>
        <Text numberOfLines={1} style={styles.subtitle}>{questions[0]?.title}</Text></View>
      <Text style={styles.buttonText}>回答</Text>
      <Ionicons name="chevron-forward" size={15} color={palette.muted} />
    </Pressable>
    <BottomSheet fullWidthContent visible={open} tall title="需要你的补充" onClose={() => setOpen(false)}
      dismissible={!busy} dragFromHeaderOnly actions={[
        { label: '取消回答', disabled: busy, onPress: cancel },
        { label: '提交回答', tone: 'primary', loading: busy,
          disabled: disabled || answers.some((value) => !value.trim()), onPress: submit },
      ]}>
      <SheetScrollView style={questionStyles.scroll} contentContainerStyle={questionStyles.content}
        keyboardShouldPersistTaps="handled">
        {questions.map((question, index) => <QuestionField key={index} question={question}
          value={answers[index] ?? ''} disabled={disabled || busy} submit={() => { void submit(); }}
          update={(value) => setAnswers((previous) => previous.map((entry, position) =>
            position === index ? value : entry))} />)}
        {!!(error || failure) && <Text accessibilityRole="alert" style={styles.error}>{error || failure}</Text>}
      </SheetScrollView>
    </BottomSheet>
  </>;
}

export function ChatAsyncQuestions({ thread, ...props }: Props) {
  const [cancelled, setCancelled] = useState<Set<string>>(() => new Set());
  const questionKey = (item: Item) => JSON.stringify([thread?.id, item.id]);
  const questions = pendingQuestions(thread).filter((item) => !cancelled.has(questionKey(item)));
  if (!questions.length) return null;
  return <ScrollView style={questionStyles.entries} contentContainerStyle={questionStyles.entryContent}
    keyboardShouldPersistTaps="handled">
    {questions.map((item) => <QuestionCard key={questionKey(item)} item={item} {...props}
      onCancel={() => setCancelled((previous) => new Set(previous).add(questionKey(item)))} />)}
  </ScrollView>;
}

const questionStyles = StyleSheet.create({
  entries: { flexGrow: 0, maxHeight: 180 },
  entryContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
    borderWidth: 1, borderColor: palette.border, borderRadius: 12, backgroundColor: '#fff' },
  scroll: { flexShrink: 1 },
  content: { gap: 20, paddingBottom: 20, maxWidth: SHEET_READABLE_WIDTH, width: '100%', alignSelf: 'center' },
  question: { gap: 12 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  input: { minHeight: 42, maxHeight: 120, textAlignVertical: 'top' },
});
