export interface ChatClientInfo { name: string; platform: string }

export function browserClientInfo(): ChatClientInfo {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  let platform = 'Web';
  if (/Android/i.test(agent)) platform = 'Android';
  else if (/iPhone|iPad/i.test(agent)) platform = 'iOS';
  else if (/Windows/i.test(agent)) platform = 'Windows';
  else if (/Macintosh|Mac OS/i.test(agent)) platform = 'macOS';
  else if (/Linux/i.test(agent)) platform = 'Linux';
  let browser = '浏览器';
  if (/Edg\//.test(agent)) browser = 'Edge';
  else if (/Firefox\//.test(agent)) browser = 'Firefox';
  else if (/Chrome\//.test(agent)) browser = 'Chrome';
  else if (/Safari\//.test(agent)) browser = 'Safari';
  return { name: `${platform} · ${browser}`, platform };
}
