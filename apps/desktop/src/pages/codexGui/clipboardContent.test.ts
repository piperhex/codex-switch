// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readPastedContent } from '../../../../../shared/chat/clipboard';

const png = 'data:image/png;base64,aGVsbG8=';
const image = () => new File(['image'], 'image.png', { type: 'image/png' });
function clipboard({ text = '', html = '', files = [] }: { text?: string; html?: string; files?: File[] }) {
  const data = { files, getData: (type: string) => type === 'text/html' ? html : text };
  return readPastedContent(data as unknown as DataTransfer);
}

it('recognizes actual QQ HTML file references without losing the accompanying text', () => {
  const result = clipboard({ text: '检查更新\r\n', html: String.raw`检查更新<br>
    <img src="file:///C:\Users\User\Tencent Files\nt_qq\nt_data\Pic\Ori\image.png">` });
  expect(result).toEqual({ files: [], text: '检查更新\n', hasImages: true, missingImages: true });
});

it('preserves text alongside image files and does not decode duplicate HTML images', () => {
  const file = image();
  expect(clipboard({ text: '说明文字', html: `<img src="${png}">`, files: [file] }))
    .toEqual({ files: [file], text: '说明文字', hasImages: true, missingImages: false });
  expect(clipboard({ text: '说明文字', files: [file] }).text).toBe('说明文字');
});

it('reads multiple embedded images and HTML-only text with line breaks and entities', () => {
  const result = clipboard({ html: `<div>第一行 &amp; 第二行<br>说明</div><img src="${png}"><img src="${png}">` });
  expect(result.text).toBe('第一行 & 第二行\n说明');
  expect(result.files).toHaveLength(2);
  expect(result.files[0].type).toBe('image/png');
  expect(result.missingImages).toBe(false);
});

it('ignores active markup and refuses unsupported image URLs without fetching them', () => {
  const result = clipboard({ html: `<script>alert('secret')</script><style>secret</style>
    <iframe src="https://example.com"></iframe><img src="https://example.com/photo.png">
    <img src="data:image/svg+xml;base64,abcd"><img src="data:image/png;base64,!!!">` });
  expect(result.text).not.toContain('secret');
  expect(result.files).toEqual([]);
  expect(result.missingImages).toBe(true);
});

it('suppresses Explorer file names but preserves text-only paths', () => {
  expect(clipboard({ text: 'C:\\Images\\image.png', files: [image()] }).text).toBe('');
  expect(clipboard({ text: 'C:\\Images\\image.png' }).text).toBe('C:\\Images\\image.png');
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  expect(clipboard({ text: 'notes.txt', files: [file] }).text).toBe('');
});
