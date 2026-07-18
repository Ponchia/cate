// =============================================================================
// RepoChip — the container-workspace "which repo is this?" chip, sibling of
// WorktreePill in a panel's top-right corner. Shown only when the panel's
// context path resolves to an inventoried repo that ISN'T the workspace root —
// i.e. exactly the multi-repo (container) case, where the workspace-level
// branch pill can't speak for anything. Shows repo name, and branch + dirty
// dot once the attention-bounded git monitor has reported for this repo.
//
// Collapsed to a branch glyph until hovered (same economy as WorktreePill).
// Click → context menu: reveal in Source Control (future), open a terminal at
// the repo root.
// =============================================================================

import React, { useState } from 'react'
import { GitBranch } from '@phosphor-icons/react'
import { useAppStore } from '../stores/appStore'
import { useRepoContextStore } from '../stores/repoContextStore'
import { nearestRepoFor, repoDisplayName } from '../../shared/repoMatch'
import { panelContextPath } from '../hooks/useRepoContext'
import type { PanelState } from '../../shared/types'

interface RepoChipProps {
  panel: PanelState
  workspaceId: string
}

export const RepoChip: React.FC<RepoChipProps> = ({ panel, workspaceId }) => {
  const rootPath = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.rootPath ?? null)
  const repos = useRepoContextStore((s) => s.reposByWorkspace[workspaceId]?.repos ?? null)
  const path = panelContextPath(panel, rootPath)
  const repo = repos ? nearestRepoFor(repos, path) : null
  const status = useRepoContextStore((s) => (repo ? s.statusByRepo[repo] ?? null : null))
  const createTerminal = useAppStore((s) => s.createTerminal)
  const [hovered, setHovered] = useState(false)

  // Container case only: a repo that isn't the workspace root itself.
  if (!repo || repo === rootPath) return null

  const name = repoDisplayName(repo)
  const label = status ? `${name} · ${status.branch}` : name

  const handleClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const choice = await window.electronAPI.showContextMenu([
      { id: 'terminal', label: `New terminal in ${name}` },
    ])
    if (choice === 'terminal') {
      createTerminal(workspaceId, undefined, undefined, undefined, repo)
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => { void handleClick(e) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={(e) => e.stopPropagation()}
      title={status ? `${name} — ${status.branch}${status.isDirty ? ' (dirty)' : ''}` : name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: hovered ? 4 : 0,
        height: 18,
        maxWidth: 240,
        padding: hovered ? '0 9px 0 7px' : '0 4px',
        borderRadius: 9,
        backgroundColor: 'color-mix(in srgb, var(--surface-2) 80%, black)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: 0.2,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'gap 150ms ease, padding 150ms ease',
      }}
    >
      <GitBranch size={11} style={{ flexShrink: 0 }} />
      {status?.isDirty && (
        <span
          aria-label="dirty"
          style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: 'var(--focus-blue, #3b82f6)', flexShrink: 0, marginLeft: 2 }}
        />
      )}
      <span
        style={{
          maxWidth: hovered ? 200 : 0,
          opacity: hovered ? 1 : 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'max-width 150ms ease, opacity 150ms ease',
        }}
      >
        {label}
      </span>
    </button>
  )
}
