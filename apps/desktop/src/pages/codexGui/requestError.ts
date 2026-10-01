import { guiText } from "../../i18n/guiText";
export interface RequestError {
  message: string;
  additionalDetails?: string | null;
}

export const MODEL_CAPACITY_MESSAGE = "Selected model is at capacity. Please try a different model.";

export function isModelCapacityError(error?: RequestError | null): boolean {
  return [error?.message, error?.additionalDetails].some((text) =>
    typeof text === "string" && /\bselected\s+model\s+is\s+at\s+capacity\b/i.test(text));
}

function redactCredentials(text: string): string {
  // Proxy diagnostics can echo request credentials; retain the failure reason, not authentication values.
  return text.replace(/(Bearer\s+)[^\s"',;]+/gi, guiText("$1[已隐藏]"))
    .replace(/(["']?(?:api[-_]?key|access_token|refresh_token|token|password)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
      guiText("$1[已隐藏]"))
    .replace(/(https?:\/\/)[^/\s:@]+:[^/@\s]+@/gi, guiText("$1[已隐藏]@"));
}

/** Keep the diagnostic text readable without rendering upstream content as HTML. */
export function requestErrorDetails(error: RequestError): string {
  return [...new Set([error.message, error.additionalDetails]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => redactCredentials(part.trim())))].join("\n\n");
}
