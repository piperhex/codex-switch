/* Bundled locally with xterm; terminal output is data and never becomes HTML. */
const terminal = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 5000,
  theme: { background: '#ffffff', foreground: '#242424', cursor: '#14806f' } });
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal'));
const send = message => window.ReactNativeWebView.postMessage(JSON.stringify(message));
terminal.onData(data => send({ type: 'input', data }));
terminal.onResize(size => send({ type: 'resize', ...size }));
window.remoteTerminal = event => {
  if (event.type === 'output') terminal.write(new Uint8Array(event.data));
  if (event.type === 'exit') terminal.options.disableStdin = true;
};
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    send({ type: 'input', data: JSON.parse(button.dataset.key) });
    terminal.focus();
  });
}
let frame = 0;
const resize = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => fit.fit());
};
new ResizeObserver(resize).observe(document.getElementById('terminal'));
requestAnimationFrame(() => {
  fit.fit();
  send({ type: 'ready', cols: terminal.cols, rows: terminal.rows });
});
