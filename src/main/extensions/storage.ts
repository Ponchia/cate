// =============================================================================
// Extension storage — per-extension `cate.storage`, backed by a hand-editable
// JSON file at `<project>/.cate/extensions/<extensionId>/storage.json` ON the
// workspace's runtime host (local OR remote), accessed through `runtime.file.*`.
// This is the single, branch-free path: the daemon owns the disk (local is just
// another daemon), so a remote workspace's extension storage lives on the remote,
// exactly like the workspace's own `.cate/workspace.json` (projectWorkspaceStore).
//
// On-disk layout (one file per extension per project):
//
//   {
//     "<key>": <json value>,            // extension-scoped KV (top level)
//     "__panels__": {                   // reserved per-panel slices
//       "<panelId>": { "<key>": <json value> }
//     }
//   }
//
// `__panels__` is reserved — extension-scoped get/set/delete/keys operate on the
// top level and skip it, so a panel slice can never collide with an extension key.
//
// Each (runtime, project, extensionId) gets one cached store: async initial load
// (runtime.file.readFile), in-memory authority for synchronous get/set, debounced
// runtime.file.writeFile, and a runtime.file.watch that reloads on external edits
// (suppressing our own write echo by content compare).
// =============================================================================

import log from '../logger'
import { parseLocator, type RuntimeId } from '../runtime/locator'
import { runtimes } from '../runtime/runtimeManager'
import { getWorkspaceInfo } from '../workspaceManager'
import { hostJoin } from '../../agent/main/agentDir'
import type { Runtime } from '../runtime/types'

/** Reserved sub-object holding per-panel slices. */
const PANELS_KEY = '__panels__'
/** Debounce window for batching writes (matches the old jsonStateFile cadence). */
const WRITE_DEBOUNCE_MS = 150

type StorageShape = Record<string, unknown>

/** A live storage handle for one (extensionId, project) pair. Reads/writes are
 *  synchronous against the in-memory authority; writes flush async + debounced. */
export interface ExtensionStorage {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
  keys(): string[]
  panelGet(panelId: string, key: string): unknown
  panelSet(panelId: string, key: string, value: unknown): void
  /** Subscribe to external edits (the runtime watcher). Fires with no args;
   *  consumers re-read what they need. Idempotent — one watcher per store. */
  onChange(cb: () => void): () => void
}

interface Store {
  handle: ExtensionStorage
  /** Flush nothing / stop the watcher and release resources. Called when a
   *  runtime disconnects (disposeStoresForRuntime) so we don't strand a watcher
   *  bound to a dead runtime handle. */
  dispose(): void
}

// Cache keyed by `<runtimeId>\0<hostFilePath>`; the promise is stored so two
// concurrent first-callers share one async load instead of racing two stores.
const stores = new Map<string, Promise<Store>>()

/** Resolve a workspace id to its runtime + host project root, or null. */
function locate(workspaceId: string): { runtime: Runtime; root: string } | null {
  const info = getWorkspaceInfo(workspaceId)
  if (!info) return null
  const { runtimeId, path: root } = parseLocator(info.rootPath)
  if (!root) return null
  try {
    return { runtime: runtimes.resolve(runtimeId), root }
  } catch {
    // Runtime not connected — no storage until it is.
    return null
  }
}

function storageFile(runtimeId: RuntimeId, projectRoot: string, extensionId: string): string {
  return hostJoin(runtimeId, projectRoot, '.cate', 'extensions', extensionId, 'storage.json')
}

/** Read + parse the host file, or {} when missing/corrupt. */
async function loadData(file: string, host: Runtime['file']): Promise<StorageShape> {
  try {
    const parsed = JSON.parse(await host.readFile(file)) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as StorageShape) }
    }
  } catch {
    // Missing file or invalid JSON → start from defaults.
  }
  return {}
}

async function createStore(runtimeId: RuntimeId, file: string): Promise<Store> {
  // Resolve the runtime FRESH per operation from the registry rather than
  // capturing it: a disconnect/reconnect builds a NEW Runtime under the same id,
  // and this long-lived store must write/read/watch through the CURRENT one, not
  // the dead handle it was created with (otherwise writes are silently lost).
  const currentFileHost = (): Runtime['file'] | null => {
    try { return runtimes.resolve(runtimeId).file } catch { return null }
  }

  const host0 = currentFileHost()
  let data: StorageShape = host0 ? await loadData(file, host0) : {}
  const subscribers = new Set<() => void>()
  let writeTimer: ReturnType<typeof setTimeout> | null = null
  /** The runtime watcher disposer, kept so we can stop watching (finding #2). */
  let unwatch: (() => void) | null = null
  // The JSON of our last scheduled write, so the watcher can ignore the change
  // event our own writeFile produces (otherwise every set() would echo back).
  let lastWritten: string | null = null

  const scheduleWrite = (): void => {
    if (writeTimer) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      const host = currentFileHost()
      if (!host) {
        log.warn('[extensions] storage write skipped, runtime %s not connected: %s', runtimeId, file)
        return
      }
      const json = JSON.stringify(data, null, 2)
      lastWritten = json
      void host
        .writeFile(file, json)
        .catch((err) => log.warn('[extensions] storage write failed %s: %O', file, err))
    }, WRITE_DEBOUNCE_MS)
    writeTimer.unref?.()
  }

  const update = (fn: (cur: StorageShape) => StorageShape): void => {
    data = fn(data)
    scheduleWrite()
  }

  const ensureWatching = (): void => {
    if (unwatch) return
    const host = currentFileHost()
    if (!host) return
    unwatch = host.watch(file, () => {
      void (async () => {
        const h = currentFileHost()
        if (!h) return
        const fresh = await loadData(file, h)
        const json = JSON.stringify(fresh, null, 2)
        if (json === lastWritten) return // our own write echoed back
        data = fresh
        for (const cb of subscribers) {
          try { cb() } catch { /* a subscriber throwing must not block others */ }
        }
      })()
    })
  }

  const stopWatching = (): void => {
    if (!unwatch) return
    try { unwatch() } catch { /* disposer must not throw on teardown */ }
    unwatch = null
  }

  const handle: ExtensionStorage = {
    get(key) {
      return data[key]
    },
    set(key, value) {
      update((cur) => ({ ...cur, [key]: value }))
    },
    delete(key) {
      update((cur) => {
        const next = { ...cur }
        delete next[key]
        return next
      })
    },
    keys() {
      return Object.keys(data).filter((k) => k !== PANELS_KEY)
    },
    panelGet(panelId, key) {
      const panels = data[PANELS_KEY]
      if (panels && typeof panels === 'object' && !Array.isArray(panels)) {
        const slice = (panels as Record<string, unknown>)[panelId]
        if (slice && typeof slice === 'object' && !Array.isArray(slice)) {
          return (slice as Record<string, unknown>)[key]
        }
      }
      return undefined
    },
    panelSet(panelId, key, value) {
      update((cur) => {
        const panelsRaw = cur[PANELS_KEY]
        const panels =
          panelsRaw && typeof panelsRaw === 'object' && !Array.isArray(panelsRaw)
            ? { ...(panelsRaw as Record<string, Record<string, unknown>>) }
            : {}
        const sliceRaw = panels[panelId]
        const slice =
          sliceRaw && typeof sliceRaw === 'object' && !Array.isArray(sliceRaw)
            ? { ...sliceRaw }
            : {}
        slice[key] = value
        panels[panelId] = slice
        return { ...cur, [PANELS_KEY]: panels }
      })
    },
    onChange(cb) {
      subscribers.add(cb)
      ensureWatching()
      return () => {
        subscribers.delete(cb)
        // Last subscriber gone → stop the runtime watcher so it isn't left live
        // for a closed panel (finding #2). A later subscriber re-arms it.
        if (subscribers.size === 0) stopWatching()
      }
    },
  }

  return {
    handle,
    dispose() {
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null }
      subscribers.clear()
      stopWatching()
    },
  }
}

/**
 * Get (creating + caching on first use) the storage handle for an extension in a
 * workspace. Returns null when the workspace is unknown or its runtime isn't
 * connected. The handle's get/set are synchronous (in-memory authority); the
 * initial load is awaited here so the first get() already reflects on-disk state.
 */
export async function getExtensionStorage(
  extensionId: string,
  workspaceId: string,
): Promise<ExtensionStorage | null> {
  const loc = locate(workspaceId)
  if (!loc) return null
  const file = storageFile(loc.runtime.id, loc.root, extensionId)
  const cacheKey = `${loc.runtime.id}\0${file}`
  let entry = stores.get(cacheKey)
  if (!entry) {
    entry = createStore(loc.runtime.id, file)
    stores.set(cacheKey, entry)
  }
  return (await entry).handle
}

/**
 * Evict + dispose every cached store bound to `runtimeId` (stop its watcher,
 * cancel any pending write). Exported so ExtensionManager can call it when a
 * runtime disconnects, so watchers/data don't survive against a dead handle.
 * A subsequent getExtensionStorage rebuilds the store against the current runtime.
 */
export function disposeStoresForRuntime(runtimeId: RuntimeId): void {
  const prefix = `${runtimeId}\0`
  for (const key of [...stores.keys()]) {
    if (!key.startsWith(prefix)) continue
    const entry = stores.get(key)
    stores.delete(key)
    void entry?.then((s) => s.dispose()).catch(() => { /* creation failed; nothing to dispose */ })
  }
}
