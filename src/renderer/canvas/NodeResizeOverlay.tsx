// Invisible resize hotspots layered above the panel content. Needed
// because `<webview>` (BrowserPanel) eats pointer events inside its
// rectangle, so detectEdge-on-mousemove never fires for browser panels.
// Only covers the bottom corners + left/right/bottom edges — the top
// strip is owned by the tab bar (close X, maximize, drag).

import React from 'react'
import type { ResizeEdge } from '../hooks/useNodeResize'

interface NodeResizeOverlayProps {
  onResizeStart: (e: React.MouseEvent, edge: ResizeEdge) => void
  cornerSize?: number
  edgeSize?: number
  /** Title-bar height so the side edges start where panel content begins. */
  topInset?: number
}

const baseStyle: React.CSSProperties = {
  position: 'absolute',
  background: 'transparent',
  zIndex: 50,
  userSelect: 'none',
}

export const NodeResizeOverlay: React.FC<NodeResizeOverlayProps> = ({
  onResizeStart,
  cornerSize = 12,
  edgeSize = 6,
  topInset = 26,
}) => {
  const mk = (edge: ResizeEdge, style: React.CSSProperties, cursor: string) => (
    <div
      key={edge}
      data-resize-overlay={edge}
      style={{ ...baseStyle, ...style, cursor }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        onResizeStart(e, edge)
      }}
    />
  )

  return (
    <>
      {mk('bottomLeft',  { bottom: 0, left: 0, width: cornerSize, height: cornerSize }, 'nesw-resize')}
      {mk('bottomRight', { bottom: 0, right: 0, width: cornerSize, height: cornerSize }, 'nwse-resize')}
      {mk('bottom', { bottom: 0, left: cornerSize, right: cornerSize, height: edgeSize }, 'ns-resize')}
      {mk('left',   { top: topInset, bottom: cornerSize, left: 0, width: edgeSize }, 'ew-resize')}
      {mk('right',  { top: topInset, bottom: cornerSize, right: 0, width: edgeSize }, 'ew-resize')}
    </>
  )
}
