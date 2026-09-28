const { expo } = require('./app.json');

// Set these in the release environment after creating the Expo project and Apple App ID.
module.exports = () => {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const bundleIdentifier = process.env.IOS_BUNDLE_IDENTIFIER;
  return { ...expo,
    ...(projectId ? { extra: { ...expo.extra, eas: { projectId } } } : {}),
    ios: { ...expo.ios, ...(bundleIdentifier ? { bundleIdentifier } : {}) },
  };
};
