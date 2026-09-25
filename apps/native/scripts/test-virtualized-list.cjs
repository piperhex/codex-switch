const fs = require('node:fs');
const { createRequire } = require('node:module');
const { transformSync } = require('@babel/core');

const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const listPath = nativeRequire.resolve('@react-native/virtualized-lists/Lists/VirtualizedList.js');
const listRequire = createRequire(listPath);
const plugins = [[require.resolve('babel-plugin-syntax-hermes-parser'), { parseLangTypes: 'flow' }],
  require.resolve('@babel/plugin-transform-flow-strip-types'),
  require.resolve('@babel/plugin-transform-modules-commonjs')];

function compile(source, extraPlugins = []) {
  const result = transformSync(source, { filename: 'VirtualizedList.js', configFile: false, babelrc: false,
    plugins: [...extraPlugins, ...plugins] });
  if (!result?.code) throw new Error('Unable to compile the installed native list source.');
  return result.code;
}

function loadModule(name) {
  const exports = {};
  const source = fs.readFileSync(listRequire.resolve(name), 'utf8');
  new Function('require', 'exports', compile(source))(listRequire, exports);
  return exports;
}

/** Run the installed state transitions and render mask without mocking their range calculations. */
function loadListStateMachine(source) {
  const onlyStaticMethods = () => ({ visitor: { Program(program) {
    const declaration = program.node.body.find(node => node.type === 'ClassDeclaration'
      && node.id.name === 'VirtualizedList');
    if (!declaration) throw new Error('Missing native VirtualizedList class.');
    declaration.superClass = null;
    declaration.body.body = declaration.body.body.filter(node => node.type === 'ClassMethod' && node.static);
    program.node.body = [declaration];
  } } });
  const code = compile(source, [onlyStaticMethods]);
  const defaults = loadModule('./VirtualizedListProps');
  return new Function('clamp', 'CellRenderMask', 'invariant', 'initialNumToRenderOrDefault',
    'maxToRenderPerBatchOrDefault', `${code}; return VirtualizedList;`)(
    loadModule('../Utilities/clamp').default, loadModule('./CellRenderMask').CellRenderMask,
    listRequire('invariant'), defaults.initialNumToRenderOrDefault, defaults.maxToRenderPerBatchOrDefault,
  );
}

module.exports = { loadListStateMachine, readListSource: () => fs.readFileSync(listPath, 'utf8') };
