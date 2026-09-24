import type { HistoryVersion } from '../historySync';
import type { Thread, Turn } from './types';

export type HistoryFields = HistoryVersion['fields'];
export interface PreparedHistoryObject { data: string; hash: string; fields: HistoryFields }
export type PrepareHistoryObject = (value: object, omit?: string) => Promise<PreparedHistoryObject>;
export interface HistoryVersionSource { read(thread: Thread): HistoryVersion | Promise<HistoryVersion> }

/** Platform workers own expensive fingerprints; immutable objects share their prepared cache records. */
export class AsyncHistoryVersionCache implements HistoryVersionSource {
  private readonly turns = new WeakMap<Turn, Promise<HistoryVersion['turns'][number]>>();
  constructor(private readonly prepare: PrepareHistoryObject) {}

  async read(thread: Thread): Promise<HistoryVersion> {
    const [metadata, turns] = await Promise.all([
      this.prepare(thread, 'turns'), Promise.all((thread.turns ?? []).map((turn) => this.turn(turn))),
    ]);
    return { fields: metadata.fields, turns };
  }

  private turn(turn: Turn) {
    let known = this.turns.get(turn);
    if (!known) {
      known = this.prepareTurn(turn).catch((error: unknown) => { this.turns.delete(turn); throw error; });
      this.turns.set(turn, known);
    }
    return known;
  }

  private async prepareTurn(turn: Turn) {
    const [metadata, items] = await Promise.all([
      this.prepare(turn, 'items'), Promise.all(turn.items.map(async (item) => ({
        id: item.id, fields: (await this.prepare(item)).fields,
      }))),
    ]);
    return { id: turn.id, fields: metadata.fields, items };
  }
}
