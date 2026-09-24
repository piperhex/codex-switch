const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const packageFile = (name, file) => path.join(path.dirname(require.resolve(`${name}/package.json`)), file);
const scripts = [read(packageFile('@xterm/xterm', 'lib/xterm.js')),
  read(packageFile('@xterm/addon-fit', 'lib/addon-fit.js')), read(path.join(root, 'shared/terminal/webview.js'))];
const keys = [['Ctrl+C', '\x03'], ['Tab', '\t'], ['Esc', '\x1b'], ['↑', '\x1b[A'],
  ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']];
const licenses = ['@xterm/xterm', '@xterm/addon-fit'].map(name => read(packageFile(name, 'LICENSE'))).join('\n');
const html = `<!doctype html><!-- Bundled xterm licenses:\n${licenses}\n-->
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline'">
<style>${read(packageFile('@xterm/xterm', 'css/xterm.css'))}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#fff}
body{display:flex;flex-direction:column}#terminal{flex:1;min-height:0;padding:8px}
.xterm{height:100%}.xterm-helper-textarea{font-size:16px}
nav{display:flex;gap:4px;padding:6px;flex-shrink:0;border-top:1px solid #dfe5df}
button{flex:1;min-width:0;min-height:44px;border:0;border-radius:8px;background:#eef4f1;color:#17211b}
</style></head><body><main id="terminal" aria-label="终端"></main><nav aria-label="终端快捷键">
${keys.map(([label, key]) => `<button data-key='${JSON.stringify(key)}'>${label}</button>`).join('')}
</nav>${scripts.map(script => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`).join('')}
</body></html>`;
const target = path.join(root, 'apps/native/assets/terminal.html');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || read(target) !== html) {
    throw new Error('Terminal asset is outdated. Run node apps/native/scripts/build-terminal-document.cjs');
  }
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
}
