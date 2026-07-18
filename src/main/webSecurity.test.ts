// =============================================================================
// webSecurity.installWebContentsSecurity — the will-attach-webview hardening.
// Focus: the preload pinning for extension-proxy guests. An extension guest must
// run the CANONICAL cateHost preload, never whatever preload path the renderer
// supplied (a compromised renderer could point it at an arbitrary file). A plain
// (non-proxy) guest keeps having its preload stripped entirely.
//
// Plus the guest popup policy: `window.open()` to a web URL becomes an in-app
// child window (this is how OAuth sign-in completes in-app), non-web schemes
// are denied, and popup windows are exempt from the trusted-app-URL navigation
// gate that protects real app windows.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROXY_ORIGIN = 'http://127.0.0.1:5555'
const CANONICAL_PRELOAD = '/app/dist/preload/cateHost.js'

vi.mock('./extensions/proxyServer', () => ({
  getProxyOrigin: () => PROXY_ORIGIN,
  getCateHostPreloadPath: () => CANONICAL_PRELOAD,
}))
vi.mock('./featureFlags', () => ({ disableWebviewHardening: () => false }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// Capture the app.on('web-contents-created') callback so we can drive it.
const { createdHandlers, partitionSessions } = vi.hoisted(() => ({
  createdHandlers: [] as Array<(e: unknown, c: unknown) => void>,
  partitionSessions: new Map<string, Record<string, unknown>>(),
}))
vi.mock('electron', () => ({
  app: { on: (ev: string, cb: (e: unknown, c: unknown) => void) => { if (ev === 'web-contents-created') createdHandlers.push(cb) } },
  session: {
    fromPartition: (p: string) => {
      if (!partitionSessions.has(p)) partitionSessions.set(p, makeSession())
      return partitionSessions.get(p)
    },
  },
  shell: { openExternal: vi.fn() },
}))

function makeSession(): Record<string, unknown> {
  return {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    getUserAgent: () =>
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Cate/1.5.1 Chrome/146.0.0.0 Electron/41.2.0 Safari/537.36',
    setUserAgent: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn(), onBeforeSendHeaders: vi.fn() },
  }
}

import { installWebContentsSecurity } from './webSecurity'

interface FakeContents {
  listeners: Record<string, (...a: unknown[]) => void>
  onceListeners: Record<string, (...a: unknown[]) => void>
  openHandler: ((details: { url: string }) => { action: string }) | null
  contents: Record<string, unknown>
}

let nextContentsId = 100

/** Build a fake WebContents of the given type and run the created-handlers
 *  over it, capturing its listeners and window-open handler. */
function makeContents(type: 'webview' | 'window'): FakeContents {
  const fake: FakeContents = { listeners: {}, onceListeners: {}, openHandler: null, contents: {} }
  fake.contents = {
    id: nextContentsId++,
    getType: () => type,
    on: (ev: string, cb: (...a: unknown[]) => void) => { fake.listeners[ev] = cb },
    once: (ev: string, cb: (...a: unknown[]) => void) => { fake.onceListeners[ev] = cb },
    setWindowOpenHandler: (h: FakeContents['openHandler']) => { fake.openHandler = h },
    getUserAgent: () =>
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Cate/1.5.1 Chrome/146.0.0.0 Electron/41.2.0 Safari/537.36',
    setUserAgent: vi.fn(),
    session: makeSession(),
  }
  for (const cb of createdHandlers) cb({}, fake.contents)
  return fake
}

/** Build a fake webview WebContents, run the created-handlers over it, and
 *  return its captured will-attach-webview handler. */
function attachHandlerForWebview(): (event: unknown, wp: Record<string, unknown>, params: Record<string, unknown>) => void {
  return makeContents('webview').listeners['will-attach-webview'] as never
}

beforeEach(() => {
  createdHandlers.length = 0
  installWebContentsSecurity()
})

describe('will-attach-webview — extension-proxy preload pinning', () => {
  it('overwrites an attacker-supplied preload with the canonical cateHost path for a proxy-origin guest', () => {
    const handler = attachHandlerForWebview()
    const webPreferences: Record<string, unknown> = { preload: '/tmp/evil.js', preloadURL: 'file:///tmp/evil.js' }
    const params: Record<string, unknown> = { src: `${PROXY_ORIGIN}/ext/abc123/index.html` }
    handler({ preventDefault: vi.fn() }, webPreferences, params)
    expect(webPreferences.preload).toBe(CANONICAL_PRELOAD)
    expect(webPreferences.preloadURL).toBeUndefined()
    // Standard hardening still applied.
    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.contextIsolation).toBe(true)
    expect(webPreferences.sandbox).toBe(true)
  })

  it('strips the preload entirely for a plain (non-proxy) guest', () => {
    const handler = attachHandlerForWebview()
    const webPreferences: Record<string, unknown> = { preload: '/tmp/evil.js', preloadURL: 'file:///tmp/evil.js' }
    const params: Record<string, unknown> = { src: 'https://example.com/page.html' }
    handler({ preventDefault: vi.fn() }, webPreferences, params)
    expect(webPreferences.preload).toBeUndefined()
    expect(webPreferences.preloadURL).toBeUndefined()
  })
})

describe('guest popups — in-app OAuth windows', () => {
  it('allows window.open to a web URL (OAuth popup) and denies non-web schemes', () => {
    const guest = makeContents('webview')
    expect(guest.openHandler!({ url: 'https://accounts.google.com/o/oauth2/auth' }).action).toBe('allow')
    expect(guest.openHandler!({ url: 'about:blank' }).action).toBe('allow')
    expect(guest.openHandler!({ url: 'slack://open' }).action).toBe('deny')
    expect(guest.openHandler!({ url: 'javascript:alert(1)' }).action).toBe('deny')
  })

  it('exempts a guest-opened popup from the trusted-app-URL gate, but keeps the guest URL policy', () => {
    const guest = makeContents('webview')
    const popup = makeContents('window')
    guest.listeners['did-create-window']({ webContents: popup.contents })

    // Cross-web navigation inside the OAuth popup proceeds…
    const webNav = { preventDefault: vi.fn() }
    popup.listeners['will-navigate'](webNav, 'https://accounts.google.com/signin')
    expect(webNav.preventDefault).not.toHaveBeenCalled()

    // …but non-web schemes are still blocked.
    const schemeNav = { preventDefault: vi.fn() }
    popup.listeners['will-navigate'](schemeNav, 'slack://open')
    expect(schemeNav.preventDefault).toHaveBeenCalled()

    // Once the popup's contents are destroyed the exemption is dropped.
    popup.onceListeners['destroyed']()
    const afterDestroy = { preventDefault: vi.fn() }
    popup.listeners['will-navigate'](afterDestroy, 'https://accounts.google.com/signin')
    expect(afterDestroy.preventDefault).toHaveBeenCalled()
  })

  it('still blocks real app windows from navigating to arbitrary web URLs', () => {
    const appWindow = makeContents('window')
    const nav = { preventDefault: vi.fn() }
    appWindow.listeners['will-navigate'](nav, 'https://evil.example.com')
    expect(nav.preventDefault).toHaveBeenCalled()
  })
})

describe('guest user agent', () => {
  const CLEAN_UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

  it('strips the Cate/Electron tokens from the guest session UA (request headers)', () => {
    const guest = makeContents('webview')
    ;(guest.listeners['will-attach-webview'] as (...a: unknown[]) => void)(
      { preventDefault: vi.fn() },
      { partition: 'persist:test-ua-check' },
      { src: 'https://example.com/' },
    )
    const guestSession = partitionSessions.get('persist:test-ua-check')!
    expect(guestSession.setUserAgent).toHaveBeenCalledWith(CLEAN_UA)
  })

  it('rewrites the User-Agent request header at the network layer', () => {
    const guest = makeContents('webview')
    ;(guest.listeners['will-attach-webview'] as (...a: unknown[]) => void)(
      { preventDefault: vi.fn() },
      { partition: 'persist:test-ua-header' },
      { src: 'https://example.com/' },
    )
    const guestSession = partitionSessions.get('persist:test-ua-header')!
    const webRequest = guestSession.webRequest as { onBeforeSendHeaders: ReturnType<typeof vi.fn> }
    const rewrite = webRequest.onBeforeSendHeaders.mock.calls[0][0] as (
      details: { requestHeaders: Record<string, string> },
      callback: (r: { requestHeaders: Record<string, string> }) => void,
    ) => void
    const callback = vi.fn()
    rewrite(
      {
        requestHeaders: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Cate/1.5.1 Chrome/146.0.0.0 Electron/41.2.0 Safari/537.36',
          Accept: '*/*',
        },
      },
      callback,
    )
    expect(callback).toHaveBeenCalledWith({ requestHeaders: { 'User-Agent': CLEAN_UA, Accept: '*/*' } })
  })

  it('strips the tokens at the webContents level for every contents, and again on webview attach', () => {
    // Every webContents (webview guest, app window/embedder, popup) is
    // stripped at creation — the embedder must be clean because a guest
    // re-inherits the embedder's UA at attach time.
    const guest = makeContents('webview')
    expect(guest.contents.setUserAgent).toHaveBeenCalledWith(CLEAN_UA)
    const appWindow = makeContents('window')
    expect(appWindow.contents.setUserAgent).toHaveBeenCalledWith(CLEAN_UA)

    // Belt-and-braces: the host re-strips the guest after attach resets it.
    ;(guest.contents.setUserAgent as ReturnType<typeof vi.fn>).mockClear()
    appWindow.listeners['did-attach-webview']({}, guest.contents)
    expect(guest.contents.setUserAgent).toHaveBeenCalledWith(CLEAN_UA)

    // Popups get an extra strip when created from a guest.
    const popup = makeContents('window')
    guest.listeners['did-create-window']({ webContents: popup.contents })
    expect(popup.contents.setUserAgent).toHaveBeenCalledWith(CLEAN_UA)
  })
})
