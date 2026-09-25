const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const PACKAGE_NAME = '@react-native/virtualized-lists';
const PACKAGE_VERSION = '0.79.5';
const ORIGINAL_RANGE = `    return {
      first: clamp(0, cells.first, maxFirst),
      last: Math.min(lastPossibleCellIndex, cells.last),
    };`;
const SAFE_RANGE = `    const first = clamp(0, cells.first, maxFirst);
    return {
      first,
      // A shifted anchor can move an empty render window below zero during reconnects.
      // Preserve valid empty ranges (last === first - 1), including [0, -1].
      last: clamp(first - 1, cells.last, lastPossibleCellIndex),
    };`;

/** Keep shifted render windows within CellRenderMask's inclusive range invariant. */
function patchListRenderRange(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/\r\n/g, '\n');
  const originalMatches = normalized.split(ORIGINAL_RANGE).length - 1;
  const patchedMatches = normalized.split(SAFE_RANGE).length - 1;
  if (originalMatches === 0 && patchedMatches === 1) return source;
  if (originalMatches !== 1 || patchedMatches !== 0) {
    throw new Error('VirtualizedList source changed; review the render range fix before rebuilding.');
  }
  return normalized.replace(ORIGINAL_RANGE, SAFE_RANGE).replace(/\n/g, newline);
}

/** Resolve from React Native so npm's nested and hoisted layouts patch the bundled dependency. */
function applyListRenderRangePatch() {
  const nativeDirectory = path.resolve(__dirname, '..');
  const nativeRequire = createRequire(require.resolve('react-native/package.json', { paths: [nativeDirectory] }));
  const manifestPath = nativeRequire.resolve(`${PACKAGE_NAME}/package.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== PACKAGE_VERSION) {
    throw new Error(`Review the render range fix before using ${PACKAGE_NAME} ${manifest.version}.`);
  }
  const sourcePath = path.join(path.dirname(manifestPath), 'Lists', 'VirtualizedList.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchListRenderRange(source);
  if (source !== patched) fs.writeFileSync(sourcePath, patched);
}

if (require.main === module) applyListRenderRangePatch();
module.exports = { applyListRenderRangePatch, patchListRenderRange };
