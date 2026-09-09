import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ApprovalReply, GuiEvent } from './types';
import { styles } from './styles';

export function ChatApproval({ event, respond }: { event: GuiEvent; respond: (reply: ApprovalReply) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { params, method, id } = event;
  if (id == null) return null;
  const questions = params.questions ?? [];
  const isQuestion = method === 'item/tool/requestUserInput';
  const send = async (decision: 'accept' | 'decline' | 'cancel') => {
    setBusy(true);
    try {
      await respond(isQuestion ? { id, answers: Object.fromEntries(questions.map((question) =>
        [question.id, { answers: [answers[question.id]?.trim() ?? ''] }])) } : { id, decision });
    } finally { setBusy(false); }
  };
  return <View style={styles.approval}>
    <Text style={styles.title}>{isQuestion ? '需要你的补充' : '需要你的确认'}</Text>
    {params.reason && <Text style={styles.subtitle}>{params.reason}</Text>}
    {params.command && <Text selectable style={styles.code}>{params.command}</Text>}
    {(params.cwd || params.grantRoot) && <Text style={styles.subtitle}>{params.cwd || params.grantRoot}</Text>}
    {params.permissions?.network?.enabled && <Text style={styles.subtitle}>访问网络</Text>}
    {params.permissions?.fileSystem?.read?.map((path) => <Text key={path} style={styles.subtitle}>读取：{path}</Text>)}
    {params.permissions?.fileSystem?.write?.map((path) => <Text key={path} style={styles.subtitle}>编辑：{path}</Text>)}
    {questions.map((question) => <View key={question.id} style={styles.settings}>
      <Text style={styles.messageText}>{question.question}</Text>
      {question.options?.map((option) => <Pressable key={option.label} accessibilityRole="radio"
        accessibilityState={{ checked: answers[question.id] === option.label }}
        style={[styles.choice, answers[question.id] === option.label && styles.chosen]}
        onPress={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}>
        <Text style={styles.buttonText}>{option.label}</Text>
        <Text style={styles.subtitle}>{option.description}</Text>
      </Pressable>)}
      <TextInput accessibilityLabel={question.question} style={styles.questionInput} placeholder="输入你的回答"
        secureTextEntry={question.isSecret} value={answers[question.id] ?? ''}
        onChangeText={(text) => setAnswers((current) => ({ ...current, [question.id]: text }))} />
    </View>)}
    <View style={styles.row}>
      {(isQuestion || !params.availableDecisions || params.availableDecisions.includes('accept')) &&
        <Pressable accessibilityRole="button" style={[styles.button, styles.primary]}
          disabled={busy || (isQuestion && questions.some((question) => !answers[question.id]?.trim()))}
          onPress={() => { void send('accept'); }}>
          <Text style={[styles.buttonText, styles.primaryText]}>{isQuestion ? '提交回答' : '允许这一次'}</Text>
        </Pressable>}
      {!isQuestion && <Pressable accessibilityRole="button" style={styles.button} disabled={busy}
        onPress={() => { void send(params.availableDecisions?.includes('decline') === false ? 'cancel' : 'decline'); }}>
        <Text style={styles.buttonText}>拒绝</Text>
      </Pressable>}
    </View>
  </View>;
}
