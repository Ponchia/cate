// =============================================================================
// CateAgentToolbarButton — the Cate Agent's entry point, docked as the leftmost
// item of the canvas toolbar. Color reflects activity (off/resting gray,
// observing blue, working green); clicking it toggles the toolbar's prompt input.
// =============================================================================

import React from 'react'
import { CateLogo } from '../ui/CateLogo'
import { Tooltip } from '../ui/Tooltip'
import type { CateAgentActivity } from '../../shared/types'

const COLOR: Record<CateAgentActivity, string> = {
  off: 'var(--surface-5)',
  resting: 'var(--surface-5)',
  observing: '#60a5fa',
  working: '#4ade80',
}

export const CateAgentToolbarButton: React.FC<{
  activity: CateAgentActivity
  active: boolean
  onClick: () => void
}> = ({ activity, active, onClick }) => {
  const color = COLOR[activity] ?? COLOR.resting
  const busy = activity === 'working' || activity === 'observing'
  return (
    <Tooltip label="Cate Agent — ask it to do something" placement="top">
      <button
        type="button"
        onClick={onClick}
        aria-label="Cate Agent"
        aria-pressed={active}
        style={{
          WebkitTapHighlightColor: 'transparent',
          boxShadow: `0 0 0 2px color-mix(in srgb, ${color} ${busy ? 70 : 50}%, transparent)`,
        }}
        className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-100 active:scale-[0.92] ${
          active ? 'bg-hover-strong' : 'bg-transparent hover:bg-hover-strong'
        }`}
      >
        <CateLogo size={20} />
      </button>
    </Tooltip>
  )
}
