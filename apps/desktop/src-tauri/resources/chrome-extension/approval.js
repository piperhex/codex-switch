const id = new URL(location.href).searchParams.get('id');
const error = document.querySelector('#error');
const buttons = [...document.querySelectorAll('button')];
const response = await chrome.runtime.sendMessage({ operation: 'request', id });
if (!response?.result) {
  document.querySelector('#origin').textContent = '这次请求已结束，可以关闭此窗口。';
  buttons.forEach((button) => { button.disabled = true; });
} else {
  document.querySelector('#origin').textContent = response.result.origin;
}
buttons.forEach((button) => button.addEventListener('click', async () => {
  buttons.forEach((button) => { button.disabled = true; });
  const reply = await chrome.runtime.sendMessage({ operation: 'decide', id, decision: button.dataset.decision });
  if (reply.error) { error.hidden = false; error.textContent = reply.error; return; }
  window.close();
}));
