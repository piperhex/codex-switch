const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const distribution = path.dirname(require.resolve('katex'));
const css = read(path.join(distribution, 'katex.min.css'))
  .replace(/src:[^;}]+/g, sources => {
    const font = sources.match(/url\(([^)]+\.woff2)\) format\("woff2"\)/);
    if (!font) throw new Error('Missing WOFF2 source in KaTeX stylesheet');
    const data = fs.readFileSync(path.join(distribution, font[1])).toString('base64');
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
const license = read(path.join(distribution, '../LICENSE'));
const content = JSON.stringify({ license, css }) + '\n';
const target = path.join(__dirname, '../assets/math-css.json');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || read(target) !== content) {
    throw new Error('Math fonts are outdated. Run node apps/native/scripts/build-math-css.cjs');
  }
} else {
  fs.writeFileSync(target, content);
}
