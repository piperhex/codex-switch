export interface AttachmentReference {
  kind: "file" | "folder" | "plugin";
  name: string;
  path: string;
  /** Inline bytes selected on a phone; materialized by the PC before sending. */
  data?: string;
}
export const MAX_ATTACHMENTS = 32;

export interface ComposerPlugin {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  iconUrl?: string;
  interface?: { displayName?: string | null; shortDescription?: string | null;
    composerIconUrl?: string | null; logoUrl?: string | null };
}
export interface PluginsResponse {
  marketplaces: { plugins: ComposerPlugin[] }[];
  marketplaceLoadErrors: unknown[];
}
