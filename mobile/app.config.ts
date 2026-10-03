/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One version for the whole product: the repository's VERSION file.
 * Android versionCode / iOS buildNumber derive from it (1.2.3 → 1002003),
 * so every release is strictly increasing without manual bookkeeping.
 *
 * APP_VARIANT selects the build flavour; each installs side by side:
 *   development  debug client for `expo start`
 *   preview      internal testing; may talk to a plain-HTTP server on the LAN
 *   production   store / customer builds; HTTPS only
 */
const version = readFileSync(join(__dirname, '..', 'VERSION'), 'utf8').trim();
const [major, minor, patch] = version.split('.').map(Number);
if ([major, minor, patch].some((n) => !Number.isInteger(n))) throw new Error(`VERSION must be semver, got "${version}"`);
const buildNumber = major * 1_000_000 + minor * 1_000 + patch;

type Variant = 'development' | 'preview' | 'production';
const variant = (process.env.APP_VARIANT ?? 'development') as Variant;

const variants: Record<Variant, { name: string; id: string; cleartext: boolean }> = {
  development: { name: 'هوشبان Dev', id: 'ir.hooshban.app.dev', cleartext: true },
  preview: { name: 'هوشبان Preview', id: 'ir.hooshban.app.preview', cleartext: true },
  production: { name: 'هوشبان', id: 'ir.hooshban.app', cleartext: false },
};
const v = variants[variant];
if (!v) throw new Error(`Unknown APP_VARIANT "${variant}"`);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: v.name,
  slug: 'hooshban',
  scheme: 'hooshban',
  version,
  runtimeVersion: version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0A0C10',
  ios: {
    supportsTablet: true,
    bundleIdentifier: v.id,
    buildNumber: String(buildNumber),
  },
  android: {
    package: v.id,
    versionCode: buildNumber,
    adaptiveIcon: {
      backgroundColor: '#0A0C10',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    allowBackup: false,
  },
  web: { favicon: './assets/favicon.png' },
  experiments: { typedRoutes: true },
  extra: { variant },
  plugins: [
    'expo-router',
    ['expo-localization', { supportsRTL: true, forcesRTL: true }],
    'expo-secure-store',
    'expo-font',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#0A0C10' }],
    [
      'expo-build-properties',
      {
        // Plain HTTP only for dev/preview builds that talk to a LAN server.
        android: {
          usesCleartextTraffic: v.cleartext,
          // Optional override to match an SDK already installed (e.g. the
          // Docker build image), avoiding downloads from blocked Google hosts.
          ...(process.env.ANDROID_COMPILE_SDK && { compileSdkVersion: Number(process.env.ANDROID_COMPILE_SDK) }),
          ...(process.env.ANDROID_BUILD_TOOLS && { buildToolsVersion: process.env.ANDROID_BUILD_TOOLS }),
        },
        ios: v.cleartext ? { networkInspector: true } : {},
      },
    ],
    './plugins/withReleaseSigning',
  ],
});
