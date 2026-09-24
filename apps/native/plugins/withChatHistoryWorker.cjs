const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const PACKAGE_LINE = 'packages.add(com.codexswitch.history.ChatHistoryPackage())';

module.exports = function withChatHistoryWorker(config) {
  config = withMainApplication(config, (result) => {
    const source = result.modResults.contents;
    if (!source.includes(PACKAGE_LINE)) {
      if (!source.includes('return packages')) throw new Error('Cannot register chat history worker.');
      result.modResults.contents = source.replace('return packages', PACKAGE_LINE + '\n            return packages');
    }
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    const target = path.join(result.modRequest.platformProjectRoot, 'app/src/main/java/com/codexswitch/history');
    await fs.mkdir(target, { recursive: true });
    for (const name of ['ChatHistoryPackage.kt', 'ChatHistoryModule.kt', 'HistoryJson.kt']) {
      await fs.copyFile(path.join(__dirname, 'chatHistory', name), path.join(target, name));
    }
    return result;
  }]);
};
