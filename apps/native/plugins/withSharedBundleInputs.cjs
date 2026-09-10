const { withAppBuildGradle } = require('expo/config-plugins');

const marker = '// Shared chat sources are outside the native app root.';
const inputs = `
${marker}
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    inputs.files(fileTree(new File(rootDir, "../../../shared")) {
        include "**/*.ts", "**/*.tsx"
    }).withPropertyName("sharedChatSources").withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.files(fileTree(new File(rootDir, "../../desktop/src/pages/codexGui")) {
        include "**/*.ts", "**/*.tsx"
    }).withPropertyName("sharedDesktopChatSources").withPathSensitivity(PathSensitivity.RELATIVE)
}
`;

function addSharedBundleInputs(contents) {
  return contents.includes(marker) ? contents : `${contents}\n${inputs}`;
}

module.exports = function withSharedBundleInputs(config) {
  return withAppBuildGradle(config, (result) => {
    result.modResults.contents = addSharedBundleInputs(result.modResults.contents);
    return result;
  });
};
module.exports.addSharedBundleInputs = addSharedBundleInputs;
