// =============================================================================
// Git Monitor — polls git branch + dirty status per workspace
// =============================================================================

import { app, ipcMain } from 'electron'
import log from '../logger'
import {
  GIT_BRANCH_UPDATE,
  GIT_REPO_STATUS_UPDATE,
  GIT_MONITOR_START,
  GIT_MONITOR_SET_REPOS,
  GIT_MONITOR_STOP,
} from '../../shared/ipc-channels'
import { sendToWindow, windowFromEvent, isAnyWindowFocused } from '../windowRegistry'
import { parseLocator, formatLocator } from '../runtime/locator'
import { runtimes } from '../runtime/runtimeManager'
import type { Runtime } from '../runtime/types'

// Adaptive polling: start fast right after a detected change, back off
// exponentially while nothing changes, cap at 30s. Reset to MIN on any
// observed change or when focus returns from a blurred state.
const POLL_INTERVAL_MIN_MS = 2000
const POLL_INTERVAL_MAX_MS = 30000

interface MonitorEntry {
  timer: ReturnType<typeof setTimeout> | null
  ownerWindowId: number
  rootPath: string
  workspaceId: string
  /** Routing key of the runtime, for re-encoding repo paths into locators. */
  runtimeId: string
  /** Runtime hosting this workspace (local or remote); polled for status. */
  runtime: Runtime
  /** Whether rootPath itself is a git repo. `null` until the async probe
   *  resolves. A CONTAINER workspace (a folder OF repos — e.g. ~/bronto with
   *  30 checkouts) has a non-repo root: it is never polled, so the monitor no
   *  longer hammers `git status` against a directory that can't answer. */
  rootIsRepo: boolean | null
  /** Attention set for container workspaces: host-absolute repo paths that
   *  currently deserve live status (repos hosting open panels), fed by the
   *  renderer via GIT_MONITOR_SET_REPOS. Bounded by open panels — never by
   *  the container's full inventory (hive holds 94 repos). */
  attention: Set<string>
  /** Next delay to schedule after the current poll completes (ms). */
  nextDelayMs: number
  /** Incremented on every poll start; a poll whose epoch is stale (a newer
   *  poll was kicked, or the monitor was torn down) discards its result. This
   *  replaces the old execFile AbortController, which only abort()-ed local
   *  child processes that no longer exist on this path. */
  pollEpoch: number
  /** Unsubscribe fn from the runtime file watcher, if wired. */
  unsubscribeFs: (() => void) | null
  /** Coalesce fs-watcher bursts into at most one immediate poll. */
  fsKickPending: boolean
}

const activeMonitors: Map<string, MonitorEntry> = new Map()
/** Keyed by `${workspaceId}\0${repoPath}` — one state per polled repo. */
const lastState: Map<string, { branch: string; isDirty: boolean; branchesKey: string }> = new Map()
/** Attention sets that arrived before their workspace's monitor started
 *  (renderer effect ordering) — consumed by GIT_MONITOR_START. */
const pendingAttention: Map<string, string[]> = new Map()

/** True iff at least one BrowserWindow is currently focused. */
let anyWindowFocused: boolean = false

function refreshFocusState(): boolean {
  anyWindowFocused = isAnyWindowFocused()
  return anyWindowFocused
}

function clearTimer(entry: MonitorEntry): void {
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
}

function scheduleNext(entry: MonitorEntry, delayMs: number): void {
  clearTimer(entry)
  if (!anyWindowFocused) {
    // Paused while no window has focus — focus handler will re-schedule.
    return
  }
  entry.timer = setTimeout(() => {
    void tick(entry)
  }, delayMs)
}

async function tick(entry: MonitorEntry): Promise<void> {
  entry.timer = null
  if (!anyWindowFocused) return
  const changed = await pollGitStatus(entry)
  if (changed) {
    entry.nextDelayMs = POLL_INTERVAL_MIN_MS
  } else {
    entry.nextDelayMs = Math.min(entry.nextDelayMs * 2, POLL_INTERVAL_MAX_MS)
  }
  scheduleNext(entry, entry.nextDelayMs)
}

/** The repo paths this entry should poll: the root (when it IS a repo) plus
 *  the container attention set. Empty for a container with no attended repos. */
function pollTargets(entry: MonitorEntry): string[] {
  const targets = new Set<string>()
  if (entry.rootIsRepo) targets.add(entry.rootPath)
  for (const p of entry.attention) targets.add(p)
  return [...targets]
}

/**
 * Run one git poll via the workspace's runtime. For the local runtime this
 * is byte-identical to the old raw-git poll (same `git branch/status/for-each-ref`
 * commands, run by the unified vcs capability); for a remote runtime the
 * commands run on the daemon host, so the sidebar reflects the remote repo.
 * Polls EVERY target repo (the root for repo workspaces; the attention set for
 * containers). Returns true iff any observable state changed, which drives the
 * adaptive interval reset. Per-repo results broadcast on GIT_REPO_STATUS_UPDATE;
 * the workspace-root repo additionally keeps the legacy GIT_BRANCH_UPDATE.
 */
async function pollGitStatus(entry: MonitorEntry): Promise<boolean> {
  const { ownerWindowId, workspaceId, rootPath, runtimeId, runtime } = entry

  // A newer poll (or teardown) supersedes this one: bump the epoch, and discard
  // our own result if it changes again before we resolve.
  const epoch = ++entry.pollEpoch
  const targets = pollTargets(entry)
  if (targets.length === 0) return false

  const results = await Promise.all(targets.map(async (repoPath) => {
    try {
      const { branch, dirty: isDirty, branches } = await runtime.vcs.monitorStatus(repoPath, { scopeId: workspaceId })

      // Stale: a fresher poll started, or the monitor was torn down/restarted.
      if (entry.pollEpoch !== epoch || !activeMonitors.has(workspaceId)) return false
      if (!branch) return false

      // Sort so reordering (e.g. committerdate changes) doesn't spuriously
      // look like a list change; a newline-joined canonical string is
      // cheaper to diff than the array.
      const branchesKey = [...branches].sort().join('\n')

      const stateKey = `${workspaceId}\0${repoPath}`
      const prev = lastState.get(stateKey)
      if (
        prev
        && prev.branch === branch
        && prev.isDirty === isDirty
        && prev.branchesKey === branchesKey
      ) return false

      lastState.set(stateKey, { branch, isDirty, branchesKey })
      const repoLocator = formatLocator({ runtimeId, path: repoPath })
      sendToWindow(ownerWindowId, GIT_REPO_STATUS_UPDATE, workspaceId, repoLocator, branch, isDirty)
      if (repoPath === rootPath) {
        sendToWindow(ownerWindowId, GIT_BRANCH_UPDATE, workspaceId, branch, isDirty)
      }
      return true
    } catch (err) {
      log.debug(
        'git monitor poll failed for %s: %s',
        repoPath,
        err instanceof Error ? err.message : String(err),
      )
      return false
    }
  }))
  return results.some(Boolean)
}

/** Resume polling for every active monitor (called on focus return). */
function resumeAllMonitors(): void {
  for (const entry of activeMonitors.values()) {
    // Treat focus return like a detected change: poll immediately and
    // reset back-off so the user sees a fresh state right away.
    entry.nextDelayMs = POLL_INTERVAL_MIN_MS
    clearTimer(entry)
    void tick(entry)
  }
}

/** Pause every active monitor (called when all windows blur). */
function pauseAllMonitors(): void {
  for (const entry of activeMonitors.values()) {
    clearTimer(entry)
    // Supersede any in-flight poll so its late result is discarded.
    entry.pollEpoch++
  }
}

let appHooksInstalled = false
function installAppHooks(): void {
  if (appHooksInstalled) return
  appHooksInstalled = true
  refreshFocusState()
  app.on('browser-window-focus', () => {
    const wasFocused = anyWindowFocused
    anyWindowFocused = true
    if (!wasFocused) resumeAllMonitors()
  })
  app.on('browser-window-blur', () => {
    // browser-window-blur fires *before* focus transfers to another window
    // in the same app, so re-derive truth from the window list rather than
    // trusting a single event.
    const stillFocused = refreshFocusState()
    if (!stillFocused) pauseAllMonitors()
  })
}

/**
 * Stop all monitors owned by a specific window (called on window close).
 */
export function stopMonitorsForWindow(windowId: number): void {
  for (const [workspaceId, entry] of activeMonitors) {
    if (entry.ownerWindowId === windowId) {
      clearTimer(entry)
      entry.pollEpoch++
      entry.unsubscribeFs?.()
      activeMonitors.delete(workspaceId)
      pendingAttention.delete(workspaceId)
      for (const key of [...lastState.keys()]) {
        if (key.startsWith(`${workspaceId}\0`)) lastState.delete(key)
      }
    }
  }
}

export function registerHandlers(): void {
  installAppHooks()

  ipcMain.on(GIT_MONITOR_START, (event, workspaceId: string, rootPath: string) => {
    // `ipcMain.on` handlers have no promise boundary, so any throw inside
    // escapes as an uncaught exception and crashes the main process with a
    // fatal Electron dialog. resolve() legitimately throws here during session
    // restore (renderer requests monitoring before the workspace's runtime is
    // registered), so treat that as "don't start monitoring" instead of a hard
    // error. No client-side path validation: the daemon validates the root
    // inside every monitorStatus poll / watch it serves, local and remote
    // alike — so a remote workspace's branch/dirty indicator reflects the
    // remote repo.
    const { runtimeId, path: rootP } = parseLocator(rootPath)
    let runtime: ReturnType<typeof runtimes.resolve>
    try {
      runtime = runtimes.resolve(runtimeId)
    } catch (err) {
      log.warn(
        '[git-monitor] skipping monitor for workspace %s: %s',
        workspaceId,
        err instanceof Error ? err.message : String(err),
      )
      return
    }
    const validRoot = rootP
    const existing = activeMonitors.get(workspaceId)
    if (existing) {
      clearTimer(existing)
      existing.pollEpoch++
      existing.unsubscribeFs?.()
    }

    const win = windowFromEvent(event)
    const ownerWindowId = win?.id ?? -1

    const entry: MonitorEntry = {
      timer: null,
      ownerWindowId,
      rootPath: validRoot,
      workspaceId,
      runtimeId,
      runtime,
      // Unknown until probed below; polls hold off so a container root is
      // never hammered with git commands that can only fail.
      rootIsRepo: null,
      attention: new Set(pendingAttention.get(workspaceId) ?? []),
      nextDelayMs: POLL_INTERVAL_MIN_MS,
      pollEpoch: 0,
      unsubscribeFs: null,
      fsKickPending: false,
    }
    pendingAttention.delete(workspaceId)

    // Wire fs-watcher events from the runtime file watcher to trigger an
    // immediate poll. The periodic timer becomes a safety net for changes
    // the watcher may miss (e.g. atomic renames on some filesystems, or repo
    // mutations that happen before any watcher root covers this path).
    entry.unsubscribeFs = runtime.file.watch(validRoot, () => {
      if (!anyWindowFocused) return
      if (entry.fsKickPending) return
      entry.fsKickPending = true
      // Coalesce the inbound burst on the next tick before kicking a poll.
      setImmediate(() => {
        entry.fsKickPending = false
        if (!activeMonitors.has(workspaceId)) return
        entry.nextDelayMs = POLL_INTERVAL_MIN_MS
        clearTimer(entry)
        void tick(entry)
      })
    }, { scopeId: workspaceId })

    activeMonitors.set(workspaceId, entry)

    // Probe whether the root is a repo, then kick the first poll. A container
    // root (folder of repos) resolves false: nothing polls until the renderer
    // sends an attention set — but any pending set starts polling right away.
    void runtime.vcs.isRepo(validRoot, { scopeId: workspaceId })
      .catch(() => false)
      .then((isRepo) => {
        if (!activeMonitors.has(workspaceId) || activeMonitors.get(workspaceId) !== entry) return
        entry.rootIsRepo = isRepo
        if (!isRepo) log.debug('[git-monitor] %s is a container root (not a repo); polling attention set only', validRoot)
        void tick(entry)
      })
  })

  // Container workspaces: the renderer's attention set — repos (locators) that
  // currently host open panels. Replaces the whole set; kicks an immediate poll
  // so new panels see fresh status. Arriving before the monitor starts is
  // stashed and consumed by GIT_MONITOR_START.
  ipcMain.on(GIT_MONITOR_SET_REPOS, (_event, workspaceId: string, repoLocators: string[]) => {
    const paths = (Array.isArray(repoLocators) ? repoLocators : [])
      .map((loc) => parseLocator(String(loc)).path)
      .filter(Boolean)
    const entry = activeMonitors.get(workspaceId)
    if (!entry) {
      pendingAttention.set(workspaceId, paths)
      return
    }
    const before = [...entry.attention].sort().join('\n')
    entry.attention = new Set(paths)
    // Drop cached state for repos that left the set, so re-attention re-emits.
    for (const key of [...lastState.keys()]) {
      const [ws, repoPath] = key.split('\0')
      if (ws === workspaceId && repoPath !== entry.rootPath && !entry.attention.has(repoPath)) {
        lastState.delete(key)
      }
    }
    if (before !== [...entry.attention].sort().join('\n')) {
      entry.nextDelayMs = POLL_INTERVAL_MIN_MS
      clearTimer(entry)
      void tick(entry)
    }
  })

  ipcMain.on(GIT_MONITOR_STOP, (_event, workspaceId: string) => {
    const entry = activeMonitors.get(workspaceId)
    if (entry) {
      clearTimer(entry)
      entry.pollEpoch++
      entry.unsubscribeFs?.()
      activeMonitors.delete(workspaceId)
    }
    pendingAttention.delete(workspaceId)
    for (const key of [...lastState.keys()]) {
      if (key.startsWith(`${workspaceId}\0`)) lastState.delete(key)
    }
  })
}
