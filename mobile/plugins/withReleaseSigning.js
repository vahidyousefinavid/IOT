// Config plugin: sign Android release builds with our own upload key.
//
// The key never lives in the repository. CI decodes it from a secret and
// exposes it through environment variables read by Gradle at build time:
//   HOOSHBAN_KEYSTORE, HOOSHBAN_KEYSTORE_PASSWORD, HOOSHBAN_KEY_ALIAS, HOOSHBAN_KEY_PASSWORD
//
// Production builds refuse to fall back to the debug key; preview builds
// may, so they stay installable on test phones without secrets.
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
            def ks = System.getenv('HOOSHBAN_KEYSTORE')
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv('HOOSHBAN_KEYSTORE_PASSWORD')
                keyAlias System.getenv('HOOSHBAN_KEY_ALIAS')
                keyPassword System.getenv('HOOSHBAN_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  const production = config.extra?.variant === 'production';
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes("System.getenv('HOOSHBAN_KEYSTORE')")) return cfg;

    const anchor = 'signingConfigs {';
    if (!gradle.includes(anchor) || !gradle.includes('signingConfig signingConfigs.debug\n            def enableShrinkResources')) {
      throw new Error('withReleaseSigning: unexpected build.gradle layout; update the plugin');
    }
    gradle = gradle.replace(anchor, anchor + SIGNING);

    // Without a keystore, Gradle itself fails the production release
    // packaging ("missing required property storeFile") — never debug-signed.
    const choose = production
      ? 'signingConfig signingConfigs.release'
      : `signingConfig System.getenv('HOOSHBAN_KEYSTORE') ? signingConfigs.release : signingConfigs.debug`;
    gradle = gradle.replace(
      'signingConfig signingConfigs.debug\n            def enableShrinkResources',
      `${choose}\n            def enableShrinkResources`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
