import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The packaged Android app is the same build the browser runs — `dist/` is the whole app, so
 * nothing about the game changes between the two. Only the shell does.
 */
const config: CapacitorConfig = {
  appId: 'com.catonblt.getaway',
  appName: 'Getaway',
  webDir: 'dist',
  android: {
    // The game paints its own background; letting the webview show white on rotate looks broken.
    backgroundColor: '#0b0d10',
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
