import { guiApi } from "./api";
import type { ListResponse, Model } from "./types";

interface CatalogHost {
  ready: () => boolean;
  accept: (models: Model[]) => void;
}

/** Serializes paginated reads and discards responses from a previous connection or account. */
export class GuiModelCatalog {
  private active = true;
  private generation = 0;
  private pending?: Promise<void>;
  constructor(private readonly host: CatalogHost) {}

  refresh = (): Promise<void> => {
    if (!this.active || !this.host.ready()) return Promise.resolve();
    return this.pending ??= this.load().finally(() => { this.pending = undefined; });
  };

  invalidate = () => { this.generation++; return this.refresh(); };
  activate = () => { this.active = true; };
  suspend = () => { this.active = false; this.generation++; };

  private async load() {
    while (this.active && this.host.ready()) {
      const generation = this.generation;
      try {
        const models = await this.readPages(generation);
        if (!this.active) return;
        if (generation !== this.generation) continue;
        this.host.accept(models);
        return;
      } catch (error) {
        if (!this.active) return;
        if (generation !== this.generation) continue;
        throw error;
      }
    }
  }

  private async readPages(generation: number) {
    let cursor: string | undefined;
    const models: Model[] = [];
    const cursors = new Set<string>();
    do {
      const response = await guiApi.request<ListResponse<Model>>({ operation: "models", cursor });
      if (!this.active || generation !== this.generation) return models;
      models.push(...response.data);
      cursor = response.nextCursor || undefined;
      if (cursor && cursors.has(cursor)) throw new Error("模型列表暂时无法更新，请稍后重试。");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return models;
  }
}
