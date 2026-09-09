import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import type { Model, SendInput } from './types';

interface Props {
  models: Model[];
  active: boolean;
  ready: boolean;
  sending: boolean;
  running: boolean;
  send: (input: SendInput) => Promise<boolean>;
  interrupt: () => void;
}
const effortLabels: Record<string, string> = {
  low: '轻量', medium: '标准', high: '深入', xhigh: '更深入', minimal: '快速', none: '关闭', max: '最高', ultra: '极高',
};

export function ChatComposer({ models, active, ready, sending, running, send, interrupt }: Props) {
  const [text, setText] = useState('');
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState('');
  const [access, setAccess] = useState<SendInput['access']>('workspace-write');
  const [settings, setSettings] = useState(false);
  useEffect(() => { if (!active) setSettings(false); }, [active]);
  const model = models.find((entry) => entry.model === modelId) ?? models.find((entry) => entry.isDefault) ?? models[0];
  const submit = async () => {
    if (!ready || sending || !text.trim()) return;
    const submitted = text;
    const sent = await send({ text: submitted, model: modelId || undefined,
      effort: effort || (modelId ? model?.defaultReasoningEffort : undefined), access });
    if (sent) setText((current) => current === submitted ? '' : current);
  };
  const submitLabel = running ? '补充消息' : '发送消息';
  const buttonText = sending ? '发送中' : running ? '补充' : '发送 ↑';
  return <>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea aria-label="聊天消息" value={text} maxLength={100_000} rows={2}
        onChange={(event) => setText(event.target.value)} placeholder={ready ? '发消息给 Codex…' : '连接后即可发送消息'}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault(); void submit();
        }} />
      <div className="chat-row">
        <button type="button" className="chat-button chat-grow chat-model" onClick={() => setSettings(true)}>
          {modelId ? model?.displayName : '沿用电脑模型'} ▾</button>
        {running && <button type="button" className="chat-button" aria-label="停止回复" disabled={!ready}
          onClick={interrupt}>停止</button>}
        <button type="submit" className="chat-button chat-primary" aria-label={submitLabel}
          disabled={!ready || sending || !text.trim()}>{buttonText}</button>
      </div>
    </form>
    <AdaptiveSheet open={settings} title="聊天设置" width={400} onClose={() => setSettings(false)}>
      <div className="chat-settings">
        <label>模型<select aria-label="模型" value={modelId}
          onChange={(event) => { setModelId(event.target.value); setEffort(''); }}>
          <option value="">沿用电脑设置</option>
          {models.map((entry) => <option key={entry.id} value={entry.model}>{entry.displayName}</option>)}
        </select></label>
        <label>思考深度<select aria-label="思考深度" value={effort} onChange={(event) => setEffort(event.target.value)}>
          <option value="">沿用电脑设置</option>
          {model?.supportedReasoningEfforts?.map((entry) => <option key={entry.reasoningEffort}
            value={entry.reasoningEffort}>{effortLabels[entry.reasoningEffort] ?? entry.reasoningEffort}</option>)}
        </select></label>
        <label>文件权限<select aria-label="文件权限" value={access}
          onChange={(event) => setAccess(event.target.value as SendInput['access'])}>
          <option value="workspace-write">允许编辑当前项目</option><option value="read-only">仅查看文件</option>
        </select></label>
        <button type="button" className="chat-button chat-primary" onClick={() => setSettings(false)}>完成</button>
      </div>
    </AdaptiveSheet>
  </>;
}
