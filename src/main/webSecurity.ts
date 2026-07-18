import { app, session, type Session, type WebContents } from 'electron'
import log from './logger'
import { disableWebviewHardening } from './featureFlags'
import { BROWSER_SHORTCUT } from '../shared/ipc-channels'
import type { BrowserShortcutAction } from '../shared/types'
import { getProxyOrigin, getCateHostPreloadPath } from './extensions/proxyServer'

/** True iff `url` is served by the local extension proxy (an extension guest).
 *  Such guests keep their cateHost preload (the reverse-API bridge) rather than
 *  having it stripped like a plain browser-panel webview. */
function isExtensionProxyUrl(url: string): boolean {
  const origin = getProxyOrigin()
  if (!origin) return false
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/** Map a webview guest key event to a browser navigation action. Returns null
 *  for keys we don't own, so the guest page handles them normally. Uses
 *  `input.code` (layout-independent) rather than `input.key`. */
function browserActionForInput(input: Electron.Input): BrowserShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const mod = process.platform === 'darwin' ? input.meta : input.control
  if (!mod) return null
  switch (input.code) {
    case 'KeyR':
      return input.shift ? 'reloadHard' : 'reload'
    case 'KeyL':
      return input.shift ? null : 'focusUrl'
    case 'BracketLeft':
      return input.shift ? null : 'back'
    case 'BracketRight':
      return input.shift ? null : 'forward'
    default:
      return null
  }
}

// OAuth/sign-in flows (Google, Microsoft, Apple, GitHub) run IN-APP. This
// replaced the upstream design (issue #220) of shell.openExternal-ing OAuth
// URLs — completing the login in the system browser could never hand the
// session back to the webview, so in-app "Sign in with Google" was impossible.
// Redirect-style flows (Slack's "Continue with Google" and most providers'
// fallback) navigate the webview itself and are verified working end-to-end.
// The popup path (window.open) is wired below — allowpopups on the tag, allow
// in setWindowOpenHandler, popup windows share the guest session — but on
// Electron 41 the guest's window.open still resolves null before reaching the
// handler (Page.windowOpen fires, handler never invoked; a minimal repro
// outside Cate works, root cause unidentified). Known-open item.
// The providers' "this browser may not be secure" block is UA-sniffing, which
// the stripAppTokens plumbing below addresses (see also main/index.ts).
//
// WebContents ids of live guest-opened popup windows. Popups are exempt from
// the trusted-app-URL navigation gate that protects real app windows, and get
// the guest navigation policy (http/https/about:blank only) instead.
const guestPopupIds = new Set<number>()

/** Drop the `Cate/x.y.z` and `Electron/x.y.z` tokens so web content sees a
 *  plain Chrome user agent. */
function stripAppTokens(userAgent: string): string {
  return userAgent.replace(/\s(?:cate|electron)\/\S+/gi, '')
}

const configuredGuestSessions = new Set<string>()

function isTrustedAppUrl(url: string): boolean {
  if (url.startsWith('file://')) return true
  if (!process.env.ELECTRON_RENDERER_URL) return false
  try {
    return new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
  } catch {
    return false
  }
}

function isAllowedGuestUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const parsed = new URL(url)
    // Allow file: so the browser panel can render local HTML files explicitly
    // requested by the user via the address bar. Cross-origin reads from a
    // remote page into file:// are blocked by the same-origin policy.
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:'
  } catch {
    return false
  }
}

function configureGuestSessionPolicies(targetSession: Session, sessionKey: string): void {
  if (configuredGuestSessions.has(sessionKey)) return
  configuredGuestSessions.add(sessionKey)

  // Present as plain Chrome in request headers. The session-level UA covers
  // main-frame navigations (what an OAuth provider sees when serving its
  // sign-in page); the webRequest rewrite is belt-and-braces. Known limit on
  // this Electron version: navigator.userAgent and renderer-initiated fetch()
  // headers keep the app tokens — Google's sign-in block keys off the
  // navigation UA, which is clean (verified live against accounts.google.com).
  targetSession.setUserAgent(stripAppTokens(targetSession.getUserAgent()))
  targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const ua = details.requestHeaders['User-Agent']
    if (typeof ua === 'string') details.requestHeaders['User-Agent'] = stripAppTokens(ua)
    callback({ requestHeaders: details.requestHeaders })
  })

  const allowedPermissions = new Set(['cookies', 'storage-access'])

  targetSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (allowedPermissions.has(permission)) {
      callback(true)
      return
    }
    log.warn('[webview] Denied guest permission request: %s', permission)
    callback(false)
  })

  targetSession.setPermissionCheckHandler((_wc, permission) => allowedPermissions.has(permission))

  targetSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'mainFrame' && !isAllowedGuestUrl(details.url)) {
      log.warn('[webview] Blocked guest navigation to %s', details.url)
      callback({ cancel: true })
      return
    }
    callback({})
  })
}

function guestSessionFor(contents: WebContents, partition?: string): Session {
  if (partition) return session.fromPartition(partition)
  return contents.session
}

export function installWebContentsSecurity(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Web content must see a plain Chrome UA — OAuth providers sniff the
    // `Cate/…`/`Electron/…` tokens and hard-block sign-in ("this browser may
    // not be secure"). Applied to EVERY webContents because a <webview> guest
    // re-inherits its embedder's UA at attach time — stripping only the guest
    // at creation gets overwritten, so the embedder (app window) must be clean
    // too. The did-attach-webview strip below catches the post-attach reset
    // directly.
    contents.setUserAgent(stripAppTokens(contents.getUserAgent()))

    if (contents.getType() === 'webview') {
      // `window.open()` from a guest page opens a native popup window sharing
      // the guest's session — this is how OAuth/Sign-In popups complete in-app
      // (the popup writes its cookies into the same persistent partition the
      // webview reads). Non-web schemes (slack://, itms://, …) are denied; the
      // page's own fallback handles them.
      contents.setWindowOpenHandler(({ url }) => {
        if (!isAllowedGuestUrl(url)) {
          log.warn('[webview] Denied guest popup to %s', url)
          return { action: 'deny' }
        }
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 560,
            height: 700,
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        }
      })

      contents.on('did-create-window', (win) => {
        const popupId = win.webContents.id
        guestPopupIds.add(popupId)
        win.webContents.setUserAgent(stripAppTokens(win.webContents.getUserAgent()))
        win.webContents.once('destroyed', () => guestPopupIds.delete(popupId))
      })

      // Capture browser navigation keys (Cmd+R/[/]/L) even when the guest page
      // has keyboard focus, and forward them to the embedding renderer so the
      // focused BrowserPanel can act. Scoped to webview guests, so Monaco's
      // Cmd+[ / Cmd+] / Cmd+L are never affected.
      contents.on('before-input-event', (event, input) => {
        const action = browserActionForInput(input)
        if (!action) return
        event.preventDefault()
        try {
          contents.hostWebContents?.send(BROWSER_SHORTCUT, action)
        } catch {
          /* host gone — ignore */
        }
      })
    } else {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    }

    if (contents.getType() === 'window') {
      contents.on('will-navigate', (event, url) => {
        // Guest-opened popups (OAuth flows) navigate freely across the web —
        // they get the guest URL policy. Real app windows only ever navigate
        // within the app bundle / dev server.
        if (guestPopupIds.has(contents.id)) {
          if (!isAllowedGuestUrl(url)) {
            log.warn('[webview] Blocked popup navigation to %s', url)
            event.preventDefault()
          }
          return
        }
        if (!isTrustedAppUrl(url)) {
          log.warn('[security] Blocked app-window navigation to %s', url)
          event.preventDefault()
        }
      })
    }

    contents.on('did-attach-webview', (_e, guest) => {
      guest.setUserAgent(stripAppTokens(guest.getUserAgent()))
    })

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      if (disableWebviewHardening()) return

      const src = typeof params.src === 'string' ? params.src : 'about:blank'
      if (!isAllowedGuestUrl(src)) {
        log.warn('[webview] Blocked guest attach for URL %s', src)
        event.preventDefault()
        return
      }

      // Extension guests (served by the local proxy) get the cateHost preload —
      // the sandboxed reverse-API bridge. Do NOT trust the preload path the
      // renderer supplied (a compromised renderer could point it at an arbitrary
      // file); PIN it to the canonical cateHost bundle. Every other guest
      // (browser panel) has its preload stripped entirely: browser screenshots
      // are captured from the main process via capturePage(), so no preload needed.
      if (isExtensionProxyUrl(src)) {
        ;(webPreferences as { preload?: string }).preload = getCateHostPreloadPath()
        delete (webPreferences as { preloadURL?: string }).preloadURL
        log.info('[webview] Pinned cateHost preload for extension guest %s', src)
      } else {
        delete (webPreferences as { preload?: string }).preload
        delete (webPreferences as { preloadURL?: string }).preloadURL
      }
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      ;(webPreferences as { allowRunningInsecureContent?: boolean }).allowRunningInsecureContent = false

      // Popup capability must be on the <webview> tag itself (see the ref
      // callback in BrowserPanel.tsx): the guest renderer bakes the popup gate
      // in at guest creation, BEFORE this hook — mutating params.allowpopups
      // or webPreferences.disablePopups here is too late (verified live). The
      // setWindowOpenHandler installed when the guest's webContents is created
      // strictly filters which popup URLs are actually allowed.

      const partition = typeof webPreferences.partition === 'string' ? webPreferences.partition : undefined
      const targetSession = guestSessionFor(contents, partition)
      configureGuestSessionPolicies(targetSession, partition ?? '__default__')
    })
  })
}
