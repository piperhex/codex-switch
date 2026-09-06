import type { CodexConfigDocument } from "../../api/codexConfig";

type DocumentOperation = (current: CodexConfigDocument | null) => Promise<CodexConfigDocument>;

/** Every save reads the revision produced by the preceding save, including rapid field changes. */
export class ConfigWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private document: CodexConfigDocument | null = null;

  enqueue(operation: DocumentOperation): Promise<CodexConfigDocument> {
    const next = this.tail.then(async () => {
      const document = await operation(this.document);
      this.document = document;
      return document;
    });
    // A rejected write must not poison the queue; the last successful revision remains authoritative.
    this.tail = next.catch(() => undefined);
    return next;
  }
}
