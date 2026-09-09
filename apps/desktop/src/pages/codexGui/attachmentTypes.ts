export interface AttachmentReference {
  kind: "file" | "folder" | "plugin";
  name: string;
  path: string;
}
export const MAX_ATTACHMENTS = 32;

export interface ComposerPlugin {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  interface?: { displayName?: string | null; shortDescription?: string | null; composerIconUrl?: string | null };
}
export interface PluginsResponse {
  marketplaces: { plugins: ComposerPlugin[] }[];
  marketplaceLoadErrors: unknown[];
}
