/* xterm's virtual viewport does not scroll in response to native touch panning. */
function attachTerminalTouch(terminal, viewport) {
  const DRAG_THRESHOLD = 6;
  const FRICTION = 0.94;
  const MIN_SPEED = 0.02;
  const MAX_FRAME_MS = 32;
  const RELEASE_PAUSE_MS = 100;
  let gesture;
  let momentum = 0;
  const rowHeight = () => terminal.element.querySelector('.xterm-screen').getBoundingClientRect().height / terminal.rows;
  const stop = () => { cancelAnimationFrame(momentum); gesture = undefined; };

  function coast(speed) {
    let previous = performance.now();
    let position = terminal.buffer.active.viewportY;
    const step = now => {
      const elapsed = Math.min(now - previous, MAX_FRAME_MS);
      previous = now;
      position = Math.max(0, Math.min(terminal.buffer.active.baseY, position + speed * elapsed / rowHeight()));
      terminal.scrollToLine(Math.round(position));
      speed *= Math.pow(FRICTION, elapsed / (1000 / 60));
      if (Math.abs(speed) > MIN_SPEED && position > 0 && position < terminal.buffer.active.baseY) {
        momentum = requestAnimationFrame(step);
      }
    };
    momentum = requestAnimationFrame(step);
  }

  viewport.addEventListener('touchstart', event => {
    stop();
    if (event.touches.length !== 1 || event.target.closest('.scrollbar')) return;
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, lastY: touch.clientY,
      row: terminal.buffer.active.viewportY, time: performance.now(), speed: 0, axis: null };
  }, { passive: true });
  viewport.addEventListener('touchmove', event => {
    if (!gesture || event.touches.length !== 1) { stop(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== gesture.id) return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
    gesture.axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (gesture.axis !== 'y') return;
    event.preventDefault();
    const now = performance.now();
    gesture.speed = (gesture.lastY - touch.clientY) / Math.max(1, now - gesture.time);
    gesture.lastY = touch.clientY;
    gesture.time = now;
    terminal.scrollToLine(Math.max(0, Math.min(terminal.buffer.active.baseY,
      gesture.row - Math.round(dy / rowHeight()))));
  }, { passive: false });
  viewport.addEventListener('touchend', () => {
    if (gesture?.axis === 'y' && performance.now() - gesture.time < RELEASE_PAUSE_MS) coast(gesture.speed);
    gesture = undefined;
  }, { passive: true });
  viewport.addEventListener('touchcancel', stop, { passive: true });
}
