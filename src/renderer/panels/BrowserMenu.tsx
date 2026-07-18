// =============================================================================
// BrowserMenu — the URL-bar overflow (⋮) dropdown for a browser panel: new tab,
// toggle the bookmarks sidebar, per-panel node behavior (live-while-unfocused,
// device emulation), and open the in-panel browser settings popover.
// =============================================================================
import { useEffect, useRef } from 'react'
import { Plus, BookmarkSimple, Gear, Check, Broadcast, DeviceMobile, Desktop } from '@phosphor-icons/react'
import { useSettingsStore } from '../stores/settingsStore'
import type { BrowserDeviceMode } from '../../shared/types'

interface Props {
  onNewTab: () => void
  onOpenSettings: () => void
  onClose: () => void
  /** Per-panel: keep the page live while the node is unfocused (Arc-easels). */
  live: boolean
  onToggleLive: () => void
  /** Per-panel device emulation. */
  device: BrowserDeviceMode
  onSetDevice: (device: BrowserDeviceMode) => void
}

export function BrowserMenu({ onNewTab, onOpenSettings, onClose, live, onToggleLive, device, onSetDevice }: Props): JSX.Element {
  const showBookmarks = useSettingsStore((s) => s.browserShowTabSidebar)
  const setSetting = useSettingsStore((s) => s.setSetting)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const item = 'w-full flex items-center gap-2.5 px-3 h-8 text-sm text-secondary hover:bg-hover transition-colors text-left'

  return (
    <div
      ref={ref}
      className="absolute right-2 top-12 z-40 w-56 rounded-lg border border-subtle bg-surface-2 shadow-2xl py-1"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className={item} onClick={() => { onClose(); onNewTab() }}>
        <Plus size={14} className="text-muted" /> New tab
      </button>
      <button
        className={item}
        onClick={() => setSetting('browserShowTabSidebar', !showBookmarks)}
      >
        <BookmarkSimple size={14} className="text-muted" />
        <span className="flex-1">Show bookmarks</span>
        {showBookmarks && <Check size={14} className="text-agent" />}
      </button>
      <div className="my-1 border-t border-subtle" />
      <button className={item} onClick={onToggleLive}>
        <Broadcast size={14} className="text-muted" />
        <span className="flex-1">Keep live when unfocused</span>
        {live && <Check size={14} className="text-agent" />}
      </button>
      <button className={item} onClick={() => onSetDevice('desktop')}>
        <Desktop size={14} className="text-muted" />
        <span className="flex-1">Load as desktop</span>
        {device === 'desktop' && <Check size={14} className="text-agent" />}
      </button>
      <button className={item} onClick={() => onSetDevice('phone')}>
        <DeviceMobile size={14} className="text-muted" />
        <span className="flex-1">Load as phone</span>
        {device === 'phone' && <Check size={14} className="text-agent" />}
      </button>
      <div className="my-1 border-t border-subtle" />
      <button className={item} onClick={() => { onClose(); onOpenSettings() }}>
        <Gear size={14} className="text-muted" /> Browser settings…
      </button>
    </div>
  )
}
