// =============================================================================
// Unit tests for the extension storage cache lifecycle: runtime rebinding on a
// disconnect/reconnect (a new Runtime with the same id) and watcher teardown
// when the last subscriber unsubscribes. These drive ./storage against a fake
// in-memory FileHost registered under LOCAL, so no real fs/daemon is involved.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cate-userData' } }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// Fake workspace lookup: one known workspace pointing at a local project root.
const getWorkspaceInfo = vi.hoisted(() => vi.fn())
vi.mock('../workspaceManager', () => ({ getWorkspaceInfo }))

import { runtimes } from '../runtime/runtimeManager'
import { LOCAL_RUNTIME_ID } from '../runtime/locator'
import type { Runtime } from '../runtime/types'
import { getExtensionStorage, disposeStoresForRuntime } from './storage'

const EXT = 'cate.test'
const ROOT = '/proj'

/** A minimal fake Runtime whose FileHost records which instance handled each
 *  write and which watchers are currently live. */
function makeFakeRuntime(label: string): {
  runtime: Runtime
  writes: Array<{ by: string; content: string }>
  liveWatchers: () => number
  setFile: (content: string) => void
  emitChange: () => void
} {
  const files = new Map<string, string>()
  const writes: Array<{ by: string; content: string }> = []
  const watchers = new Set<() => void>()

  const file = {
    async readFile(p: string): Promise<string> {
      const v = files.get(p)
      if (v == null) throw new Error('ENOENT')
      return v
    },
    async writeFile(p: string, content: string): Promise<void> {
      files.set(p, content)
      writes.push({ by: label, content })
    },
    watch(_prefix: string, onChange: () => void): () => void {
      watchers.add(onChange)
      return () => { watchers.delete(onChange) }
    },
  } as unknown as Runtime['file']

  const runtime = { id: LOCAL_RUNTIME_ID, file } as unknown as Runtime
  return {
    runtime,
    writes,
    liveWatchers: () => watchers.size,
    setFile: (content: string) => files.set(`${ROOT}/.cate/extensions/${EXT}/storage.json`, content),
    emitChange: () => { for (const cb of watchers) cb() },
  }
}

beforeEach(() => {
  getWorkspaceInfo.mockImplementation((id: string) => (id === 'ws' ? { rootPath: ROOT } : undefined))
  disposeStoresForRuntime(LOCAL_RUNTIME_ID)
})

describe('storage — runtime rebinding across disconnect/reconnect', () => {
  it('writes through the CURRENT runtime after a reconnect swaps in a new Runtime with the same id', async () => {
    const a = makeFakeRuntime('A')
    runtimes.registerLocalForTest(a.runtime)

    const s1 = await getExtensionStorage(EXT, 'ws')
    expect(s1).not.toBeNull()

    // Disconnect A, reconnect B (same id, brand-new Runtime object).
    const b = makeFakeRuntime('B')
    runtimes.registerLocalForTest(b.runtime)

    // A cached handle for the same (runtime id, file) is reused...
    const s2 = await getExtensionStorage(EXT, 'ws')
    s2!.set('k', 'v')

    // ...but the write must land on B, not the dead A.
    await vi.waitFor(() => expect(b.writes.length).toBeGreaterThan(0))
    expect(a.writes).toHaveLength(0)
    expect(b.writes.at(-1)!.content).toContain('"k"')
  })
})

describe('storage — watcher teardown on last unsubscribe', () => {
  it('stops the runtime watcher when the last subscriber unsubscribes', async () => {
    const a = makeFakeRuntime('A')
    runtimes.registerLocalForTest(a.runtime)

    const s = await getExtensionStorage(EXT, 'ws')
    const off1 = s!.onChange(() => {})
    const off2 = s!.onChange(() => {})
    expect(a.liveWatchers()).toBe(1)

    off1()
    expect(a.liveWatchers()).toBe(1) // still one subscriber
    off2()
    expect(a.liveWatchers()).toBe(0) // watcher disposed, not left live
  })
})
