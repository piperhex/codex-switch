const { withPodfile } = require('expo/config-plugins');

const marker = '# Codex Switch: enable opt-in TCP port sharing before native compilation.';
function addTcpPunchHook(contents) {
  if (contents.includes(marker)) return contents;
  const anchor = 'post_install do |installer|';
  if (contents.split(anchor).length !== 2) throw new Error('Review iOS TCP patch hook after Podfile changes.');
  return contents.replace(anchor, `${anchor}
    ${marker}
    system('node', File.join(__dir__, '../scripts/patch-cocoa-tcp-punch.cjs'),
      installer.sandbox.root.to_s, exception: true)
`);
}

module.exports = config => withPodfile(config, result => {
  result.modResults.contents = addTcpPunchHook(result.modResults.contents);
  return result;
});
module.exports.addTcpPunchHook = addTcpPunchHook;
