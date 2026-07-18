// =============================================================================
// AgentRepoPin — container-workspace repo scope for an agent panel. In a
// folder-of-repos workspace, pi at the container root has no meaningful git
// context; pinning runs it at a chosen repo instead (cwd change → AgentPanel
// reopens pi there, transcripts land in that repo's .cate/pi-agent). Hidden in
// single-repo workspaces, where the root already IS the scope.
// =============================================================================

import React from 'react'
import { GitBranch } from '@phosphor-icons/react'
import { useAppStore } from '../../renderer/stores/appStore'
import { useRepoContextStore } from '../../renderer/stores/repoContextStore'
import { repoDisplayName } from '../../shared/repoMatch'

interface AgentRepoPinProps {
  workspaceId: string
  panelId: string
  pinned: string | undefined
}

export const AgentRepoPin: React.FC<AgentRepoPinProps> = ({ workspaceId, panelId, pinned }) => {
  const rootPath = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.rootPath ?? null)
  const repos = useRepoContextStore((s) => s.reposByWorkspace[workspaceId]?.repos ?? null)
  const updatePanelAgentCwd = useAppStore((s) => s.updatePanelAgentCwd)

  // Container case only: repos exist beyond the root itself.
  const containerRepos = (repos ?? []).filter((r) => r !== rootPath)
  if (containerRepos.length === 0) return null

  const label = pinned ? repoDisplayName(pinned) : 'container root'

  const handleClick = async (): Promise<void> => {
    const choice = await window.electronAPI.showContextMenu([
      { id: '__root', label: `Container root${pinned ? '' : '  ✓'}` },
      { type: 'separator' as const },
      ...containerRepos.map((repo) => ({
        id: repo,
        label: repoDisplayName(repo) + (repo === pinned ? '  ✓' : ''),
      })),
    ])
    if (!choice) return
    updatePanelAgentCwd(workspaceId, panelId, choice === '__root' ? undefined : choice)
  }

  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => { void handleClick() }}
      title={pinned ? `Agent pinned to ${label}` : 'Pin this agent to a repo'}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted hover:text-primary hover:bg-hover"
    >
      <GitBranch size={12} />
      <span className="max-w-[140px] truncate">{label}</span>
    </button>
  )
}
