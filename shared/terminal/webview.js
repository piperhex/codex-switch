/* Bundled locally with xterm; terminal output is data and never becomes HTML. */
const terminal = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 5000,
  theme: { background: '#ffffff', foreground: '#242424', cursor: '#14806f' } });
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
const viewport = document.getElementById('viewport');
const container = document.getElementById('terminal');
terminal.open(container);
attachTerminalTouch(terminal, viewport);
// A wide PTY preserves long lines for horizontal panning, within the host's size limit.
const WIDE_COLUMNS = 500;
let wrap = true;
const send = message => window.ReactNativeWebView.postMessage(JSON.stringify(message));
terminal.onData(data => send({ type: 'input', data }));
terminal.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
window.remoteTerminal = event => {
  if (event.type === 'reset') terminal.reset();
  if (event.type === 'connection') terminal.options.disableStdin = !event.connected;
  if (event.type === 'output') terminal.write(new Uint8Array(event.data));
  if (event.type === 'exit') terminal.options.disableStdin = true;
  if (event.type === 'display') {
    wrap = event.wrap;
    document.querySelector('nav').hidden = event.shortcuts === false;
    fitTerminal();
  }
  if (event.type === 'key') { send({ type: 'input', data: event.data }); terminal.focus(); }
};
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    send({ type: 'input', data: JSON.parse(button.dataset.key) });
    terminal.focus();
  });
}
let frame = 0;
const fitTerminal = () => {
  if (wrap) {
    container.style.width = '100%';
    viewport.scrollLeft = 0;
    fit.fit();
    return;
  }
  const cellWidth = terminal.element.querySelector('.xterm-screen').getBoundingClientRect().width / terminal.cols;
  const scrollbarWidth = terminal.element.querySelector('.scrollbar.vertical').getBoundingClientRect().width;
  container.style.width = `${Math.ceil(WIDE_COLUMNS * cellWidth + scrollbarWidth)}px`;
  const dimensions = fit.proposeDimensions();
  if (dimensions) terminal.resize(WIDE_COLUMNS, dimensions.rows);
};
const resize = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(fitTerminal);
};
new ResizeObserver(resize).observe(viewport);
document.fonts.ready.then(resize);
requestAnimationFrame(() => {
  fitTerminal();
  send({ type: 'ready', cols: terminal.cols, rows: terminal.rows });
});
