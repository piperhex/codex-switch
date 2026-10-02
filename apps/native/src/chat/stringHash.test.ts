import { expect, it } from 'vitest';
import { contentHash } from '../../../../shared/remote-chat/historySync';
import { contentStringHash } from '../../../../shared/remote-chat/stringHash';

it.each(['', '中文🌍', '"\\\b\f\n\r\t\0', '\ud800x\udfff', '\u2028\u2029',
  'a'.repeat(8191) + '🌍', 'a'.repeat(8191) + '\ud800x', 'a'.repeat(8191) + '\\"',
  '🌍\ud800\n\0"\\中文'.repeat(3000),
])('preserves the existing wire and offline hash for case %#', async (value) => {
  expect(await contentStringHash(value)).toBe(contentHash(value));
});

it('lets timers run before a large image finishes hashing', async () => {
  const source = 'data:image/png;base64,' + 'abcd'.repeat(2 * 1024 * 1024);
  const expected = contentHash(source);
  let beats = 0;
  const timer = setInterval(() => { beats++; }, 0);
  try {
    expect(await contentStringHash(source)).toBe(expected);
    expect(beats).toBeGreaterThan(0);
  } finally { clearInterval(timer); }
});
