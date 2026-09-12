/** Optional network work must not keep a completed local switch busy or report it as failed. */
export function runSwitchFollowUp(action: () => unknown): void {
  void Promise.resolve().then(action).catch((error: unknown) => {
    console.warn("Account switch follow-up failed", error);
  });
}
