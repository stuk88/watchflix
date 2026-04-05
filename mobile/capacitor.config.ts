import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.watchflix.app',
  appName: 'Watchflix',
  // Points to the Vue SPA build output
  webDir: '../ui/dist',
  server: {
    // In production, set this to your deployed API URL.
    // For local development, use your machine's LAN IP (not localhost —
    // localhost on a phone refers to the phone itself).
    // Example: url: 'http://192.168.1.100:3001'
    //
    // When unset, the app loads the bundled SPA from webDir and API calls
    // use relative paths (/api/...) which require the server.url to be set.
    url: process.env.WATCHFLIX_API_URL || undefined,
    cleartext: true,  // allow http:// during development
  },
  android: {
    allowMixedContent: true,  // allow http API in https webview
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
};

export default config;
