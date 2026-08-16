process.env.EXPO_NO_METRO_WORKSPACE_ROOT = '1';

const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Keep bundle entries relative to this app while retaining access to packages
// hoisted by npm workspaces.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

function isReactModule(moduleName) {
  return moduleName === 'react' || moduleName.startsWith('react/');
}

// The web workspaces use React 18 while React Native uses React 19. Dependencies
// hoisted to the repository root must still share the native React instance.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isReactModule(moduleName)) {
    return {
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
