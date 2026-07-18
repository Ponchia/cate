// =============================================================================
// repoContextStore — container-workspace repo awareness for the renderer.
//
// Holds, per workspace, the discovered repo INVENTORY (locators from the
// daemon-side `gitFindRepos` sweep, cached with a TTL — hive holds ~94 repos,
// so discovery is on-demand, never polled) and the live per-repo STATUS
// (branch + dirty) pushed by the main git monitor for the current attention
// set. `repoForPath` is the derived primitive everything renders from: the
// nearest inventoried repo enclosing a panel's path.
// =============================================================================

import { create } from 'zustand'
import log from '../lib/logger'
import { nearestRepoFor } from '../../shared/repoMatch'

const INVENTORY_TTL_MS = 5 * 60_000

export interface RepoStatus {
  branch: string
  isDirty: boolean
}

interface RepoContextState {
  /** workspaceId → discovered repo locators (sorted, stable). */
  reposByWorkspace: Record<string, { repos: string[]; loadedAt: number; loading: boolean }>
  /** repo locator → live status (fed by GIT_REPO_STATUS_UPDATE for attended repos). */
  statusByRepo: Record<string, RepoStatus>
  /** Discover (or reuse cached) inventory for a workspace root. */
  ensureRepos(workspaceId: string, rootPath: string): Promise<void>
  /** Force a re-discovery (e.g. after cloning a new repo into the container). */
  refreshRepos(workspaceId: string, rootPath: string): Promise<void>
  setStatus(repoLocator: string, status: RepoStatus): void
}

export const useRepoContextStore = create<RepoContextState>((set, get) => ({
  reposByWorkspace: {},
  statusByRepo: {},

  async ensureRepos(workspaceId, rootPath) {
    const entry = get().reposByWorkspace[workspaceId]
    if (entry && (entry.loading || Date.now() - entry.loadedAt < INVENTORY_TTL_MS)) return
    await get().refreshRepos(workspaceId, rootPath)
  },

  async refreshRepos(workspaceId, rootPath) {
    set((s) => ({
      reposByWorkspace: {
        ...s.reposByWorkspace,
        [workspaceId]: { repos: s.reposByWorkspace[workspaceId]?.repos ?? [], loadedAt: s.reposByWorkspace[workspaceId]?.loadedAt ?? 0, loading: true },
      },
    }))
    try {
      const repos = (await window.electronAPI.gitFindRepos(rootPath, 2, workspaceId)) ?? []
      set((s) => ({
        reposByWorkspace: {
          ...s.reposByWorkspace,
          [workspaceId]: { repos: [...repos].sort(), loadedAt: Date.now(), loading: false },
        },
      }))
    } catch (err) {
      log.debug('[repo-context] discovery failed for %s: %s', rootPath, err instanceof Error ? err.message : String(err))
      // Do NOT stamp loadedAt: a failure (typically the pre-connect race — the
      // runtime isn't registered yet at boot) must not be TTL-cached as if it
      // were a result, or the workspace stays repo-blind for the whole TTL.
      set((s) => ({
        reposByWorkspace: {
          ...s.reposByWorkspace,
          [workspaceId]: { repos: s.reposByWorkspace[workspaceId]?.repos ?? [], loadedAt: s.reposByWorkspace[workspaceId]?.loadedAt ?? 0, loading: false },
        },
      }))
    }
  },

  setStatus(repoLocator, status) {
    set((s) => {
      const prev = s.statusByRepo[repoLocator]
      if (prev && prev.branch === status.branch && prev.isDirty === status.isDirty) return s
      return { statusByRepo: { ...s.statusByRepo, [repoLocator]: status } }
    })
  },
}))

/** Nearest inventoried repo enclosing `path` for this workspace (locators). */
export function repoForPath(workspaceId: string, path: string | null | undefined): string | null {
  const entry = useRepoContextStore.getState().reposByWorkspace[workspaceId]
  if (!entry) return null
  return nearestRepoFor(entry.repos, path)
}

// One process-wide subscription: fold monitor pushes into the store. Called
// from the app shell once at startup (idempotent).
let statusSubscribed = false
export function subscribeRepoStatusOnce(): void {
  if (statusSubscribed) return
  statusSubscribed = true
  window.electronAPI.onGitRepoStatusUpdate?.((_workspaceId, repoLocator, branch, isDirty) => {
    useRepoContextStore.getState().setStatus(repoLocator, { branch, isDirty })
  })
}
