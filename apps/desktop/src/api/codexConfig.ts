import { invoke } from "./backend";
import type { ConfigValue } from "../pages/codexConfig/schema";

export interface CodexConfigDiagnostic {
  message: string;
  line: number | null;
  column: number | null;
}

export interface CodexConfigDocument {
  content: string;
  revision: string;
  values: Record<string, ConfigValue> | null;
  error: CodexConfigDiagnostic | null;
}

export function readCodexConfigDocument() {
  return invoke<CodexConfigDocument>("read_codex_config_document");
}

export function validateCodexConfigDocument(content: string) {
  return invoke<CodexConfigDiagnostic | null>("validate_codex_config_document", { content });
}

export function saveCodexConfigDocument(content: string, expectedRevision: string) {
  return invoke<CodexConfigDocument>("save_codex_config_document", {
    request: { content, expectedRevision },
  });
}

export function patchCodexConfigDocument(request: {
  path: string[];
  value: ConfigValue | null;
  expectedRevision: string;
}) {
  return invoke<CodexConfigDocument>("patch_codex_config_document", { request });
}
