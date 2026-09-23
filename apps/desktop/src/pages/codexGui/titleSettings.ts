import { fetchCloudTitleSettings } from '../../api/cloudTitleSettings';
import { DEFAULT_TITLE_SETTINGS, type TitleSettings } from '../../../../../shared/chat/titleSettings';

/** One fetch per tab activation; generation waits for this fetch, never the conversation itself. */
export class GuiTitleSettings {
  private settings = { ...DEFAULT_TITLE_SETTINGS };
  private generation = 0;
  private pending?: Promise<void>;

  refresh = (): Promise<void> => {
    const generation = ++this.generation;
    const pending = fetchCloudTitleSettings().then((settings) => {
      if (generation === this.generation) this.settings = settings;
    }).catch(() => {
      // Offline clients and older servers keep the last valid settings, or the built-in defaults.
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  };

  async snapshot(): Promise<TitleSettings> {
    while (this.pending) await this.pending;
    return { ...this.settings };
  }
}
