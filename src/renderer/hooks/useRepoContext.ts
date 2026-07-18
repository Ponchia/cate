// =============================================================================
// useRepoContext — container-workspace glue, mounted once per main window.
//
// 1. Folds the main git monitor's per-repo status pushes into repoContextStore.
// 2. Discovers the workspace's repo inventory (lazily, TTL-cached).
// 3. Derives the ATTENTION SET — the repos that currently host open panels —
//    and feeds it to the main git monitor, which polls only those. This is
//    what keeps a 94-repo container (hive) cheap: status is live exactly where
//    you're working, lazy everywhere else.
// =============================================================================

import { useEffect, useMemo } from 'react'
import { useAppStore } from '../stores/appStore'
import { useRepoContextStore, repoForPath, subscribeRepoStatusOnce } from '../stores/repoContextStore'
import { nearestRepoFor } from '../../shared/repoMatch'
import type { PanelState } from '../../shared/types'

/** The path a panel's git identity derives from (null = no git context). */
export function panelContextPath(panel: PanelState, workspaceRoot: string | null): string | null {
  switch (panel.type) {
    case 'terminal':
      // Explicit cwd (worktree/repo terminals) or the workspace root (which,
      // in a container, resolves to no repo — correctly chipless).
      return panel.cwd ?? workspaceRoot
    case 'editor':
    case 'document':
      return panel.filePath ?? null
    case 'agent':
      return panel.agentCwd ?? workspaceRoot
    default:
      return null
  }
}

export function useRepoContext(workspaceId: string): void {
  useEffect(() => { subscribeRepoStatusOnce() }, [])

  const rootPath = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.rootPath ?? null)
  const panels = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.panels ?? null)
  const repos = useRepoContextStore((s) => s.reposByWorkspace[workspaceId]?.repos ?? null)

  // Inventory discovery once the workspace has a root (re-checked on TTL).
  useEffect(() => {
    if (!rootPath) return
    void useRepoContextStore.getState().ensureRepos(workspaceId, rootPath)
  }, [workspaceId, rootPath])

  // Attention set: unique repos across all open panels' context paths. The
  // joined key keeps the effect quiet unless membership actually changes.
  const attentionKey = useMemo(() => {
    if (!panels || !repos || repos.length === 0) return ''
    const set = new Set<string>()
    for (const panel of Object.values(panels)) {
      const path = panelContextPath(panel, rootPath)
      const repo = nearestRepoFor(repos, path)
      if (repo) set.add(repo)
    }
    return [...set].sort().join('\n')
  }, [panels, repos, rootPath])

  useEffect(() => {
    if (!window.electronAPI?.gitMonitorSetRepos) return
    const attended = attentionKey ? attentionKey.split('\n') : []
    window.electronAPI.gitMonitorSetRepos(workspaceId, attended)
  }, [workspaceId, attentionKey])
}

export { repoForPath }
