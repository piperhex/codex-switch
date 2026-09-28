import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { addFontScaleRefresh } = require('./withFontScaleRefresh.cjs') as {
  addFontScaleRefresh: (source: string) => string;
};
const application = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}`;

describe('Android font-scale refresh', () => {
  it('refreshes an existing runtime only when font scale changes, preserving Expo lifecycle dispatch', () => {
    const result = addFontScaleRefresh(application);
    expect(result).toContain('previousFontScale = resources.configuration.fontScale');
    expect(result).toContain('val fontScaleChanged = previousFontScale != newConfig.fontScale');
    expect(result).toContain('fontScaleChanged && reactHost.currentReactContext != null');
    expect(result).toContain('ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)');
    expect(result).toContain('reactHost.reload("System font size changed")');
    expect(addFontScaleRefresh(result)).toBe(result);
  });

  it('preserves Windows line endings and rejects an incompatible template', () => {
    const result = addFontScaleRefresh(application.replace(/\n/g, '\r\n'));
    expect(result.replace(/\r\n/g, '')).not.toContain('\n');
    expect(() => addFontScaleRefresh(application.replace('super.onCreate()', 'other()'))).toThrow();
    expect(() => addFontScaleRefresh(application + application)).toThrow();
  });
});
