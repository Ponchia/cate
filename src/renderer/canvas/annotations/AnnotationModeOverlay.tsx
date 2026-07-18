// =============================================================================
// AnnotationModeOverlay — transient view-space input surface for the two
// annotation modes:
//   draw    — click drops a default-size shape, drag draws one to size.
//   connect — click a node/shape to pick the source, click another to link.
// Mounted as a sibling AFTER the world div so it sits above all panels; it
// captures every pointer event while a mode is active. Escape (or completing
// the gesture) exits back to normal interaction.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStoreContext, useCanvasStoreApi } from '../../stores/CanvasStoreContext'
import { viewToCanvas } from '../../lib/canvas/coordinates'
import { hitTestEndpoint, resolveEndpoint, anchorPoint } from './annotationGeometry'
import { SHAPE_DEFAULT_SIZE } from '../../stores/canvas/annotationsSlice'
import type { Point } from '../../../shared/types'

const ACCENT = 'rgba(74, 158, 255, 0.9)'
const NOTE_DEFAULT_SIZE = { width: 190, height: 150 }
const NOTE_DEFAULT_COLOR = '#fbbf24'

const AnnotationModeOverlay: React.FC<{ canvasRef: React.RefObject<HTMLDivElement | null> }> = ({ canvasRef }) => {
  const canvasApi = useCanvasStoreApi()
  const mode = useCanvasStoreContext((s) => s.annotationMode)
  const connectorDraft = useCanvasStoreContext((s) => s.connectorDraft)
  // View-space live geometry for previews (local state — store stays quiet).
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [hoverTarget, setHoverTarget] = useState<{ origin: Point; size: { width: number; height: number } } | null>(null)
  const dragStart = useRef<{ view: Point; canvas: Point } | null>(null)

  const toCanvas = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return null
      const { zoomLevel, viewportOffset } = canvasApi.getState()
      return viewToCanvas({ x: clientX - rect.left, y: clientY - rect.top }, zoomLevel, viewportOffset)
    },
    [canvasApi, canvasRef],
  )

  const toView = useCallback(
    (p: Point): Point => {
      const { zoomLevel, viewportOffset } = canvasApi.getState()
      return { x: p.x * zoomLevel + viewportOffset.x, y: p.y * zoomLevel + viewportOffset.y }
    },
    [canvasApi],
  )

  const exitMode = useCallback(() => {
    canvasApi.getState().setAnnotationMode(null)
    setDrawRect(null)
    setCursor(null)
    setHoverTarget(null)
    dragStart.current = null
  }, [canvasApi])

  // Escape exits the mode.
  useEffect(() => {
    if (!mode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        exitMode()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode, exitMode])

  if (!mode) return null

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      // Right/middle click cancels the mode instead of panning underneath it.
      exitMode()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const canvasPt = toCanvas(e.clientX, e.clientY)
    if (!canvasPt) return

    if (mode.kind === 'draw') {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      dragStart.current = { view: { x: e.clientX - rect.left, y: e.clientY - rect.top }, canvas: canvasPt }
      return
    }

    // Connect mode: pick endpoints. Empty canvas is a valid FREE POINT end —
    // arrows don't have to attach to anything.
    const state = canvasApi.getState()
    const hit = hitTestEndpoint(state.nodes, state.shapes, canvasPt)
      ?? { kind: 'point' as const, point: canvasPt }
    if (!connectorDraft) {
      state.setConnectorDraft(hit)
      return
    }
    state.addConnector(connectorDraft, hit)
    exitMode()
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const viewPt = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    if (mode.kind === 'draw') {
      if (dragStart.current) {
        const s = dragStart.current.view
        setDrawRect({
          x: Math.min(s.x, viewPt.x),
          y: Math.min(s.y, viewPt.y),
          w: Math.abs(viewPt.x - s.x),
          h: Math.abs(viewPt.y - s.y),
        })
      }
      return
    }

    // Connect mode: track the cursor for the preview line and highlight the
    // endpoint target under it.
    setCursor(viewPt)
    const canvasPt = toCanvas(e.clientX, e.clientY)
    if (!canvasPt) return
    const state = canvasApi.getState()
    const hit = hitTestEndpoint(state.nodes, state.shapes, canvasPt)
    const geom = hit ? resolveEndpoint(hit, state.nodes, state.shapes) : null
    setHoverTarget(geom ? { origin: geom.rect.origin, size: geom.rect.size } : null)
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode.kind !== 'draw' || e.button !== 0 || !dragStart.current) return
    e.stopPropagation()
    const start = dragStart.current
    dragStart.current = null
    setDrawRect(null)
    const endPt = toCanvas(e.clientX, e.clientY)
    if (!endPt) return
    const state = canvasApi.getState()
    const dragged = Math.hypot(endPt.x - start.canvas.x, endPt.y - start.canvas.y) >= 8
    // Notes default to a sticky-sized amber card; frames keep the larger blue default.
    const defaultSize = mode.shape === 'note' ? NOTE_DEFAULT_SIZE : SHAPE_DEFAULT_SIZE
    const color = mode.shape === 'note' ? NOTE_DEFAULT_COLOR : undefined
    let id: string
    if (dragged) {
      id = state.addShape(
        mode.shape,
        { x: Math.min(start.canvas.x, endPt.x), y: Math.min(start.canvas.y, endPt.y) },
        { width: Math.abs(endPt.x - start.canvas.x), height: Math.abs(endPt.y - start.canvas.y) },
        color,
      )
    } else {
      id = state.addShape(mode.shape, {
        x: start.canvas.x - defaultSize.width / 2,
        y: start.canvas.y - defaultSize.height / 2,
      }, defaultSize, color)
    }
    exitMode()
    // A fresh note is for typing — open its text editor immediately.
    if (mode.shape === 'note' && id) canvasApi.getState().setPendingAnnotationEdit(id)
  }

  // Connect-mode preview line: from the draft source's anchor to the cursor.
  let previewLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (mode.kind === 'connect' && connectorDraft && cursor) {
    const state = canvasApi.getState()
    const geom = resolveEndpoint(connectorDraft, state.nodes, state.shapes)
    if (geom) {
      const canvasCursor = viewToCanvas(cursor, state.zoomLevel, state.viewportOffset)
      const from = toView(anchorPoint(geom, canvasCursor))
      previewLine = { x1: from.x, y1: from.y, x2: cursor.x, y2: cursor.y }
    }
  }

  // Draft-source + hover-target highlights (view-space rects).
  let sourceRect: { x: number; y: number; w: number; h: number } | null = null
  if (mode.kind === 'connect' && connectorDraft) {
    const state = canvasApi.getState()
    const geom = resolveEndpoint(connectorDraft, state.nodes, state.shapes)
    if (geom) {
      const tl = toView(geom.rect.origin)
      const z = state.zoomLevel
      sourceRect = { x: tl.x, y: tl.y, w: geom.rect.size.width * z, h: geom.rect.size.height * z }
    }
  }
  let hoverRect: { x: number; y: number; w: number; h: number } | null = null
  if (mode.kind === 'connect' && hoverTarget) {
    const tl = toView(hoverTarget.origin)
    const z = canvasApi.getState().zoomLevel
    hoverRect = { x: tl.x, y: tl.y, w: hoverTarget.size.width * z, h: hoverTarget.size.height * z }
  }

  const drawNoun = mode.kind === 'draw'
    ? { rect: 'rectangle', ellipse: 'ellipse', note: 'sticky note' }[mode.shape]
    : ''
  const hint =
    mode.kind === 'draw'
      ? `Click or drag to place a ${drawNoun} — Esc to cancel`
      : connectorDraft
        ? 'Click the target — a panel, a shape, or empty canvas — Esc to cancel'
        : 'Click the source — a panel, a shape, or empty canvas — Esc to cancel'

  return (
    <div
      data-annotation-mode-overlay
      style={{ position: 'absolute', inset: 0, zIndex: 100000, cursor: 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {drawRect && mode.kind === 'draw' && (
          mode.shape !== 'ellipse' ? (
            <rect
              x={drawRect.x} y={drawRect.y} width={drawRect.w} height={drawRect.h}
              rx={10} fill="rgba(74, 158, 255, 0.08)" stroke={ACCENT} strokeWidth={1.5}
            />
          ) : (
            <ellipse
              cx={drawRect.x + drawRect.w / 2} cy={drawRect.y + drawRect.h / 2}
              rx={drawRect.w / 2} ry={drawRect.h / 2}
              fill="rgba(74, 158, 255, 0.08)" stroke={ACCENT} strokeWidth={1.5}
            />
          )
        )}
        {sourceRect && (
          <rect
            x={sourceRect.x - 3} y={sourceRect.y - 3} width={sourceRect.w + 6} height={sourceRect.h + 6}
            rx={10} fill="none" stroke={ACCENT} strokeWidth={2}
          />
        )}
        {hoverRect && (
          <rect
            x={hoverRect.x - 3} y={hoverRect.y - 3} width={hoverRect.w + 6} height={hoverRect.h + 6}
            rx={10} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="5 4"
          />
        )}
        {previewLine && (
          <line
            x1={previewLine.x1} y1={previewLine.y1} x2={previewLine.x2} y2={previewLine.y2}
            stroke={ACCENT} strokeWidth={1.5} strokeDasharray="6 4"
          />
        )}
      </svg>
      {/* Bottom-center mode hint, above the toolbar. */}
      <div
        style={{
          position: 'absolute', left: '50%', bottom: 84, transform: 'translateX(-50%)',
          padding: '5px 12px', borderRadius: 999,
          background: 'color-mix(in srgb, var(--surface-0) 78%, transparent)',
          backdropFilter: 'blur(24px) saturate(1.5)',
          border: 'var(--hairline) solid var(--border-subtle)',
          color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500,
          fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap', pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {hint}
      </div>
    </div>
  )
}

export default React.memo(AnnotationModeOverlay)
