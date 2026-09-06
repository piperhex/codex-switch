import { replaceNestedValue, type ConfigValue } from "./schema";

interface ConfigArrayRow { id: number; value: ConfigValue }
type SaveArray = (value: ConfigValue[]) => Promise<boolean>;

/** Stable row identities survive deletion; queued edits always use the latest successful array. */
export class ConfigArrayWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private nextId = 0;
  private current: ConfigArrayRow[] = [];

  constructor(values: ConfigValue[]) {
    this.synchronize(values);
  }

  get rows(): ConfigArrayRow[] { return this.current; }

  synchronize(values: ConfigValue[]): boolean {
    if (this.pending || JSON.stringify(values) === JSON.stringify(this.current.map((row) => row.value))) return false;
    this.current = values.map((value) => ({ id: this.nextId++, value }));
    return true;
  }

  append(value: ConfigValue, save: SaveArray): Promise<boolean> {
    return this.enqueue(() => [...this.current, { id: this.nextId++, value }], save);
  }

  edit(options: { id: number; path: string[]; value: ConfigValue | null }, save: SaveArray): Promise<boolean> {
    return this.enqueue(() => {
      const index = this.current.findIndex((row) => row.id === options.id);
      if (index < 0) return null;
      if (!options.path.length && options.value === null) return this.current.filter((row) => row.id !== options.id);
      return this.current.map((row) => row.id === options.id ? {
        ...row, value: replaceNestedValue({ value: row.value, path: options.path, replacement: options.value }),
      } : row);
    }, save);
  }

  private enqueue(update: () => ConfigArrayRow[] | null, save: SaveArray): Promise<boolean> {
    this.pending += 1;
    const operation = this.tail.then(async () => {
      const rows = update();
      if (!rows) return false;
      const success = await save(rows.map((row) => row.value));
      if (success) this.current = rows;
      return success;
    }).finally(() => { this.pending -= 1; });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
