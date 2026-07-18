// =============================================================================
// Capacitor config — the Android wrap of the web client (dist-web). The app
// bundles the built assets and connects to the persistent daemon over ws://
// on the tailnet, exactly like the browser build. androidScheme stays `http`
// (with cleartext allowed) so the page origin is non-secure and the WebView
// permits ws:// to the tailnet daemon — an https origin would hard-block the
// mixed-content WebSocket.
// =============================================================================

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.ponchia.cate',
  appName: 'Cate',
  webDir: 'dist-web',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
