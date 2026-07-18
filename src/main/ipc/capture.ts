import { app, BrowserWindow, ipcMain, nativeImage, webContents } from 'electron'
import fs from 'fs'
import path from 'path'
import log from '../logger'
import { wrapHandler } from './handlerError'
import { grantFileAccess, validatePath } from './pathValidation'
import { isLocalLocator } from '../runtime/locator'
import { configureBrowserProxy } from '../browserProxy'
import { windowFromEvent } from '../windowRegistry'
import { WEBVIEW_SCREENSHOT, BROWSER_SET_PROXY, BROWSER_SET_DEVICE, NATIVE_FILE_DRAG } from '../../shared/ipc-channels'

export function registerCaptureHandlers(): void {
  // Capture a webview's visible content, save to disk, return dataUrl + path.
  // `wantDataUrl` defaults to true for the manual UI button (it renders the
  // thumbnail); the CLI/agent screenshot path passes false so we skip the
  // multi-MB base64 encode it would only discard. `saveTo: 'temp'` (the CLI/
  // agent path again) keeps the PNG out of the user's Desktop — agents shoot
  // constantly and the files are read-once ephemera, not keepsakes.
  ipcMain.handle(WEBVIEW_SCREENSHOT, wrapHandler(`[${WEBVIEW_SCREENSHOT}]`, async (event, webContentsId: number, options?: { wantDataUrl?: boolean; saveTo?: 'desktop' | 'temp' }) => {
    // Validate the webContentsId belongs to a webview guest of the calling window
    const callerWin = BrowserWindow.fromWebContents(event.sender)
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) return null
    // Ensure the target webContents belongs to the caller's window
    const targetWin = BrowserWindow.fromWebContents(wc)
    if (!callerWin || !targetWin || targetWin.id !== callerWin.id) {
      // For webview guests, the host window should match the caller
      const hostWc = wc.hostWebContents
      if (!hostWc || hostWc.id !== event.sender.id) {
        log.warn(`[webview:screenshot] Denied: webContentsId ${webContentsId} does not belong to calling window`)
        return null
      }
    }
    const image = await wc.capturePage()
    if (image.isEmpty()) return null

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `screenshot-${timestamp}.png`
    const dir = options?.saveTo === 'temp'
      ? path.join(app.getPath('temp'), 'cate-screenshots')
      : app.getPath('desktop')
    if (options?.saveTo === 'temp') await fs.promises.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, fileName)
    await fs.promises.writeFile(filePath, image.toPNG())
    if (callerWin) await grantFileAccess(callerWin.id, filePath)

    if (options?.wantDataUrl === false) return { filePath }
    return { filePath, dataUrl: image.toDataURL() }
  }))

  // Configure a browser panel's per-partition proxy (issue #241). Awaited by the
  // renderer before it mounts the <webview> so the first request is proxied.
  ipcMain.handle(BROWSER_SET_PROXY, wrapHandler(`[${BROWSER_SET_PROXY}]`, async (_event, partition: string, proxyUrl?: string) => {
    await configureBrowserProxy(partition, proxyUrl)
  }))

  // Device emulation for a browser panel's guest (Chrome-devtools device mode).
  // 'phone' = mobile UA + phone viewport/DPR via enableDeviceEmulation; the
  // renderer reloads the webview afterwards so the new UA reaches the server.
  // Emulation persists across navigations on the same webContents, so this only
  // needs re-issuing on mode change (or a fresh webContents). Same guest-of-
  // caller ownership check as the screenshot handler above.
  ipcMain.handle(BROWSER_SET_DEVICE, wrapHandler(`[${BROWSER_SET_DEVICE}]`, async (event, webContentsId: number, device: 'desktop' | 'phone') => {
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) return
    const hostWc = wc.hostWebContents
    if (!hostWc || hostWc.id !== event.sender.id) {
      log.warn(`[${BROWSER_SET_DEVICE}] Denied: webContentsId ${webContentsId} does not belong to calling window`)
      return
    }
    if (device === 'phone') {
      wc.enableDeviceEmulation({
        screenPosition: 'mobile',
        screenSize: { width: 390, height: 844 },
        viewSize: { width: 390, height: 844 },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 3,
        scale: 1,
      })
      wc.setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      )
    } else {
      wc.disableDeviceEmulation()
      // Back to the session's default (desktop) user agent.
      wc.setUserAgent(wc.session.getUserAgent())
    }
  }))

  // Native file drag from renderer (for screenshot thumbnails etc.)
  ipcMain.handle(NATIVE_FILE_DRAG, wrapHandler('[NATIVE_FILE_DRAG]', async (event, filePath: string) => {
    // A remote path has no local file to export into a native OS drag — no-op
    // rather than mis-resolving the locator against the local filesystem.
    if (!isLocalLocator(filePath)) {
      return { ok: false, reason: 'remote' }
    }
    const win = windowFromEvent(event)
    if (!win) return
    const validPath = validatePath(filePath, win.id)
    // Create a small drag icon from the file
    const iconSize = 64
    const iconImage = nativeImage.createFromPath(validPath)
    const icon = iconImage.isEmpty() ? nativeImage.createEmpty() : iconImage.resize({ width: iconSize })
    event.sender.startDrag({ file: validPath, icon })
  }))
}
