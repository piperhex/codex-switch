// Generate bounded extended-form fixtures from the exact parser used by the legacy backend.
const fs = require('node:fs');
const path = require('node:path');
const qs = require('qs');
const samples = new Set(['', 'email=a%40example.test&password=secret', 'z=1&a=2&10=x&2=y',
  'accounts[0][privateDetails][totpSecret]=!', 'a[32]=x&a[0]=y', 'a[101]=x',
  'a[01]=x&a[-1]=y', 'a[]=x&a[]=y', 'a[0]=x&a[0]=y', 'a[b][]=x&a[b][]=y',
  'a[]=x&a[2]=y', 'a[b]=x&a=y', 'a=x&a[b]=y', 'a[][b]=x&a[][c]=y',
  'a[b]=x&a[b]=y&a[b][c]=z', '__proto__[x]=a&constructor[b]=c',
  '[0]=x&[1]=y', 'a[b[c]]=x', 'a[broken=x', 'a[b]tail[c]=x', 'a%5Bb%5D=x',
  'a=%E9&a=%ZZ', 'a[b]=1&c=2&a[d]=3', 'a[2][z]=x&a[2][b]=y&a[1]=z']);
const keys = ['x', 'x[]', 'x[0]', 'x[2]', 'x[y]', 'x[][y]', 'x[0][y]', 'x[100]', 'x[101]'];
for (const left of keys) for (const right of keys) samples.add(`${left}=a&${right}=b&z=c`);

function orderOf(value, path = '', order = {}) {
  if (Array.isArray(value)) value.forEach((item, index) => orderOf(item, `${path}/${index}`, order));
  else if (value && typeof value === 'object') {
    order[path] = Object.keys(value);
    for (const key of Object.keys(value)) orderOf(value[key],
      `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, order);
  }
  return order;
}

const fixtures = [...samples].map((raw) => {
  const value = qs.parse(raw, { allowPrototypes: true, arrayLimit: Math.max(100, raw.split('&').length),
    depth: 32, parameterLimit: 1000, strictDepth: true });
  return { raw, value, order: orderOf(value) };
});
fs.writeFileSync(path.join(__dirname, '../testdata/form-oracle.json'),
  JSON.stringify(fixtures, null, 2) + '\n');
console.log(`Wrote ${fixtures.length} extended-form fixtures`);
