// =============================================================================
// Declarative persistent-workspace provisioning — the codified alternative to
// the connect dialog. At startup (after session restore) every entry of
// ~/.cate/persistent-workspaces.json that is not already a workspace gets one
// created and connected through the SAME store action the dialog uses, so
// behavior (secret storage, locators, phases, hydration) is identical.
// Idempotent: entries are matched against existing workspaces by their stored
// connection (token-free ws:// URL + remote path), so restarts never duplicate.
// =============================================================================

import log from '../logger'
import { useAppStore } from '../../stores/appStore'

export async function provisionPersistentWorkspaces(): Promise<void> {
  let entries: Awaited<ReturnType<typeof window.electronAPI.runtimePersistentWorkspaces>>
  try {
    entries = (await window.electronAPI.runtimePersistentWorkspaces()) ?? []
  } catch (err) {
    log.warn('[persistent-ws] listing failed:', err instanceof Error ? err.message : String(err))
    return
  }
  for (const entry of entries) {
    const { workspaces } = useAppStore.getState()
    const exists = workspaces.some((w) => {
      const conn = w.connection
      return conn?.kind === 'server' && conn.host === entry.host && conn.remotePath === entry.remotePath
    })
    if (exists) continue
    log.info('[persistent-ws] provisioning "%s" (%s %s)', entry.name, entry.host, entry.remotePath)
    const wsId = useAppStore.getState().addWorkspace(entry.name)
    const ok = await useAppStore.getState().connectRemoteWorkspace(wsId, {
      kind: 'server',
      host: entry.hostWithToken,
      user: '',
      remotePath: entry.remotePath,
    })
    if (!ok) log.warn('[persistent-ws] provisioning "%s" failed (see runtime logs)', entry.name)
  }
}
