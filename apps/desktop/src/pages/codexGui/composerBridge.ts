import { guiApi } from './api';
import type { GuiController } from './controller';
import { resolveModelSelection } from './modelSelection';
import type { Model, ListResponse } from './types';
import { composerPatch, DEFAULT_COMPOSER, type ComposerSettings,
  type ComposerSnapshot } from '../../../../../shared/remote-chat/composer';

type Binding = Pick<GuiController, 'getSnapshot' | 'subscribe' | 'settings'>;

/** Owns the small shared composer state while the main GUI is mounted or the phone is its only client. */
export class ComposerBridge {
  private binding?: Binding;
  private providerModels: Model[] | null = null;
  private value: ComposerSnapshot = { models: [], settings: { ...DEFAULT_COMPOSER }, revision: 0 };
  private readonly listeners = new Set<(snapshot: ComposerSnapshot) => void>();
  private loading?: Promise<void>;

  subscribe = (listener: (snapshot: ComposerSnapshot) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  attach(binding: Binding) {
    this.binding = binding;
    if (this.value.settings.model) binding.settings(this.value.settings);
    const update = () => {
      const { models, settings } = binding.getSnapshot();
      if (models.length) this.publish(models, settings);
    };
    update();
    const unsubscribe = binding.subscribe(update);
    return () => { unsubscribe(); if (this.binding === binding) this.binding = undefined; };
  }

  setProviderModels(models: Model[] | null) {
    if (this.providerModels === models) return;
    this.providerModels = models;
    if (models && !this.binding) this.publish(models, this.value.settings);
  }

  private publish(models: Model[], selection: ComposerSettings) {
    const settings = { ...resolveModelSelection(models, selection), access: selection.access };
    if (models === this.value.models && settings.model === this.value.settings.model
      && settings.effort === this.value.settings.effort && settings.access === this.value.settings.access) return;
    this.value = { models, settings, revision: this.value.revision + 1 };
    for (const listener of this.listeners) listener(this.value);
  }

  private async loadModels() {
    const models: Model[] = [];
    let cursor: string | undefined;
    do {
      const result = await guiApi.request<ListResponse<Model>>({ operation: 'models', cursor });
      models.push(...result.data);
      cursor = result.nextCursor || undefined;
    } while (cursor);
    if (!this.binding?.getSnapshot().models.length && !this.providerModels) this.publish(models, this.value.settings);
  }

  async read(): Promise<ComposerSnapshot> {
    const current = this.binding?.getSnapshot();
    if (current?.models.length) this.publish(current.models, current.settings);
    else if (this.providerModels) this.publish(this.providerModels, this.value.settings);
    else {
      this.loading ??= this.loadModels().finally(() => { this.loading = undefined; });
      await this.loading;
    }
    return this.value;
  }

  async update(input: unknown): Promise<ComposerSnapshot> {
    const patch = composerPatch(input);
    const current = await this.read();
    const selected = current.models.find((model) => model.model === (patch.model ?? current.settings.model));
    if (!selected) throw new Error('这个模型已不可用，请重新选择。');
    const efforts = selected.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
    if (!efforts.length) efforts.push(resolveModelSelection([selected], { model: selected.model, effort: '' }).effort);
    if (patch.effort && !efforts.includes(patch.effort)) {
      throw new Error('这个模型不支持所选思考深度，请重新选择。');
    }
    const settings = { ...current.settings, ...patch,
      ...(patch.model && patch.model !== current.settings.model && patch.effort === undefined ? { effort: '' } : {}) };
    const normalized = { ...resolveModelSelection(current.models, settings), access: settings.access };
    if (this.binding) this.binding.settings(normalized);
    this.publish(current.models, normalized);
    return this.value;
  }
}

export const guiComposer = new ComposerBridge();
