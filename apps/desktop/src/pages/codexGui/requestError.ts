export interface RequestError {
  message: string;
  additionalDetails?: string | null;
}

function redactCredentials(text: string): string {
  // Proxy diagnostics can echo request credentials; retain the failure reason, not authentication values.
  return text.replace(/(Bearer\s+)[^\s"',;]+/gi, "$1[已隐藏]")
    .replace(/(["']?(?:api[-_]?key|access_token|refresh_token|token|password)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
      "$1[已隐藏]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^/@\s]+@/gi, "$1[已隐藏]@");
}

/** Keep the diagnostic text readable without rendering upstream content as HTML. */
export function requestErrorDetails(error: RequestError): string {
  return [...new Set([error.message, error.additionalDetails]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => redactCredentials(part.trim())))].join("\n\n");
}
