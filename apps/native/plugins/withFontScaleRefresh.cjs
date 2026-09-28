const { withMainApplication } = require('expo/config-plugins');

const MARKER = '// Refresh Fabric measurements after a system font-size change.';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('MainApplication changed; review the Android font-scale refresh before rebuilding.');
  }
  return source.replace(before, after);
}

/** Android recreates the activity for font changes, but RN 0.79 retains measurements in the shared runtime. */
function addFontScaleRefresh(source) {
  if (source.includes(MARKER)) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let result = source.replace(/\r\n/g, '\n');
  result = replaceOnce(result, 'class MainApplication : Application(), ReactApplication {',
    `class MainApplication : Application(), ReactApplication {
  private var previousFontScale = 1f`);
  result = replaceOnce(result, '    super.onCreate()',
    '    super.onCreate()\n    previousFontScale = resources.configuration.fontScale');
  result = replaceOnce(result, '    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)',
    `    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
    ${MARKER}
    val fontScaleChanged = previousFontScale != newConfig.fontScale
    previousFontScale = newConfig.fontScale
    if (fontScaleChanged && reactHost.currentReactContext != null) {
      reactHost.reload("System font size changed")
    }`);
  return result.replace(/\n/g, newline);
}

module.exports = function withFontScaleRefresh(config) {
  return withMainApplication(config, result => {
    if (result.modResults.language !== 'kt') throw new Error('The font-scale refresh requires Kotlin MainApplication.');
    result.modResults.contents = addFontScaleRefresh(result.modResults.contents);
    return result;
  });
};
module.exports.addFontScaleRefresh = addFontScaleRefresh;
