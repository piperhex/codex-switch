const RENDER_TIMEOUT_MS = 1000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export async function prepareBackgroundPage(driver) {
  await driver.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const { cssLayoutViewport } = await driver.send('Page.getLayoutMetrics');
  if (cssLayoutViewport?.clientWidth > 0 && cssLayoutViewport.clientHeight > 0) return false;
  // A selected tab created while Chrome is minimized can have a zero-sized viewport. Give only
  // that debugger session a drawable viewport; do not restore, resize or focus the native window.
  const window = await chrome.windows.get(driver.tab.windowId);
  await driver.send('Emulation.setDeviceMetricsOverride', {
    width: driver.tab.width || window.width || DEFAULT_VIEWPORT.width,
    height: driver.tab.height || window.height || DEFAULT_VIEWPORT.height,
    deviceScaleFactor: 0, mobile: false,
  });
  return true;
}

export async function restoreBackgroundPage(target, viewportOverridden) {
  // Revocation can detach the debugger first. Cleanup must still run without a website-access guard.
  try {
    await chrome.debugger.sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: false });
    if (viewportOverridden) await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride');
    return true;
  } catch { return false; } // The driver detaches if overrides could not be restored.
}

// Background Chrome can defer animation-frame callbacks. Keep the renderer prepared until input-driven
// updates have had a chance to paint, but never wait indefinitely for an occluded or navigating page.
export async function settleRendering(driver) {
  const expression = `new Promise(resolve => {
    const timer = setTimeout(resolve, ${RENDER_TIMEOUT_MS});
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  })`;
  try {
    await driver.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  } catch {
    // Navigation can destroy the execution context during this best-effort rendering wait.
    // Recheck access so cancellation and permission revocation still fail the operation.
    await driver.guard();
  }
}
