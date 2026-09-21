const marker = location.pathname;
console.log('page ' + marker);
fetch('/missing?' + marker).catch(() => {});
fetch('/dropped?' + marker).catch(() => {});
fetch(location.origin.replace('127.0.0.1', 'localhost') + '/cors?' + marker).catch(() => {});
const ready = [];
function startWorker(url) {
  const worker = new Worker(url);
  ready.push(new Promise(resolve => worker.addEventListener('message', resolve, { once: true })));
  return worker;
}
window.dedicated = startWorker('/worker.js?owner=' + marker);
window.blobWorker = startWorker(URL.createObjectURL(new Blob([
  `console.log('blob ${marker}');postMessage('ready');`,
], { type: 'application/javascript' })));
window.shared = new SharedWorker('/shared.js');
window.shared.port.start();
if (marker === '/main') {
  for (const url of ['/local', location.href.replace('127.0.0.1', 'localhost').replace('/main', '/remote')]) {
    const frame = document.createElement('iframe');
    frame.src = url;
    document.body.append(frame);
    ready.push(new Promise(resolve => frame.addEventListener('load', resolve, { once: true })));
  }
}
// Re-registering a controlling worker would wait for an unrelated background update job after navigation.
ready.push(navigator.serviceWorker.controller ? navigator.serviceWorker.ready
  : navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready));
Promise.all(ready).then(() => { document.querySelector('#ready').textContent = 'Ready'; });
document.querySelector('#stop').onclick = () => { window.dedicated.terminate(); window.blobWorker.terminate(); };
