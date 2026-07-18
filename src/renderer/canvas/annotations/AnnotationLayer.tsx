// =============================================================================
// AnnotationLayer — world-space SVG rendering + direct manipulation for canvas
// shapes and connectors. Mounted inside the world div BEFORE the panel nodes,
// so annotations always paint underneath panels.
//
// Everything renders in canvas units and scales with the world transform (like
// a real drawing), so this component never subscribes to zoom/offset — it only
// re-renders when annotations, node geometry (for connector re-routing), or
// the annotation selection change.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStoreContext, useCanvasStoreApi } from '../../stores/CanvasStoreContext'
import { connectorLine, arrowheadPoints, rectCenter } from './annotationGeometry'
import { ANNOTATION_COLORS } from '../../../shared/types'
import type { CanvasShapeState, CanvasConnectorState, Point } from '../../../shared/types'

const SELECTION_COLOR = 'rgba(74, 158, 255, 0.9)'
const ARROW_SIZE = 12

type Editing =
  | { kind: 'shape'; id: string; at: Point; width: number }
  | { kind: 'connector'; id: string; at: Point }

/** Translucent fill derived from the shape's accent color. */
function fillFor(color: string): string {
  return `color-mix(in srgb, ${color} 14%, transparent)`
}

const AnnotationLayer: React.FC = () => {
  const canvasApi = useCanvasStoreApi()
  const shapes = useCanvasStoreContext((s) => s.shapes)
  const connectors = useCanvasStoreContext((s) => s.connectors)
  const nodes = useCanvasStoreContext((s) => s.nodes)
  const selection = useCanvasStoreContext((s) => s.annotationSelection)
  const [editing, setEditing] = useState<Editing | null>(null)
  // While a shape drag/resize is in flight we suppress the click-through that
  // would otherwise re-run selection logic on mouseup.
  const draggedRef = useRef(false)

  const selectOne = useCallback(
    (id: string, additive: boolean) => {
      const state = canvasApi.getState()
      if (additive) {
        const cur = state.annotationSelection
        state.selectAnnotations(
          cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
        )
      } else if (!state.annotationSelection.includes(id)) {
        state.selectAnnotations([id])
      }
    },
    [canvasApi],
  )

  // --- Shape drag (move) -----------------------------------------------------
  const handleShapeMouseDown = useCallback(
    (e: React.MouseEvent, shape: CanvasShapeState) => {
      if (e.button === 2) {
        // Keep the right-press from starting a canvas pan; contextmenu follows.
        e.stopPropagation()
        return
      }
      if (e.button !== 0) return
      e.stopPropagation()
      selectOne(shape.id, e.shiftKey)
      if (e.shiftKey) return

      const startX = e.clientX
      const startY = e.clientY
      // Move every selected shape together when the pressed one is part of a
      // multi-selection; otherwise just the pressed shape.
      const state = canvasApi.getState()
      const movingIds = (state.annotationSelection.includes(shape.id)
        ? state.annotationSelection
        : [shape.id]
      ).filter((id) => state.shapes[id])
      const startOrigins = new Map(movingIds.map((id) => [id, { ...canvasApi.getState().shapes[id].origin }]))
      let moved = false
      draggedRef.current = false

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (!moved && Math.hypot(dx, dy) < 3) return
        if (!moved) {
          moved = true
          draggedRef.current = true
          // One undo step per drag gesture, mirroring node moves.
          canvasApi.getState().pushHistory()
        }
        const zoom = canvasApi.getState().zoomLevel
        for (const [id, o] of startOrigins) {
          canvasApi.getState().updateShapeGeometry(id, { x: o.x + dx / zoom, y: o.y + dy / zoom })
        }
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [canvasApi, selectOne],
  )

  // --- Shape resize (corner handles) ----------------------------------------
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, shape: CanvasShapeState, corner: 'nw' | 'ne' | 'sw' | 'se') => {
      if (e.button !== 0) return
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const start = { origin: { ...shape.origin }, size: { ...shape.size } }
      let moved = false

      const onMove = (ev: MouseEvent) => {
        if (!moved) {
          moved = true
          draggedRef.current = true
          canvasApi.getState().pushHistory()
        }
        const zoom = canvasApi.getState().zoomLevel
        const dx = (ev.clientX - startX) / zoom
        const dy = (ev.clientY - startY) / zoom
        let { x, y } = start.origin
        let { width, height } = start.size
        if (corner.includes('w')) { x += dx; width -= dx } else { width += dx }
        if (corner.includes('n')) { y += dy; height -= dy } else { height += dy }
        // Clamp against the fixed opposite edge so the shape never flips.
        if (width < 40) {
          if (corner.includes('w')) x = start.origin.x + start.size.width - 40
          width = 40
        }
        if (height < 30) {
          if (corner.includes('n')) y = start.origin.y + start.size.height - 30
          height = 30
        }
        canvasApi.getState().updateShapeGeometry(shape.id, { x, y }, { width, height })
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [canvasApi],
  )

  // --- Context menus ---------------------------------------------------------
  const showShapeMenu = useCallback(
    async (shape: CanvasShapeState) => {
      const id = await window.electronAPI?.showContextMenu?.([
        { id: 'label', label: shape.label ? 'Edit Label' : 'Add Label' },
        {
          label: 'Shape',
          submenu: [
            { id: 'kind:rect', label: `Rectangle${shape.kind === 'rect' ? '  ✓' : ''}` },
            { id: 'kind:ellipse', label: `Ellipse${shape.kind === 'ellipse' ? '  ✓' : ''}` },
          ],
        },
        {
          label: 'Color',
          submenu: ANNOTATION_COLORS.map((c) => ({
            id: `color:${c.value}`,
            label: `${c.name}${shape.color === c.value ? '  ✓' : ''}`,
          })),
        },
        { type: 'separator' as const },
        { id: 'delete', label: 'Delete' },
      ])
      const state = canvasApi.getState()
      if (!id) return
      if (id === 'label') beginShapeLabelEdit(shape)
      else if (id.startsWith('kind:')) state.setShapeKind(shape.id, id.slice(5) as CanvasShapeState['kind'])
      else if (id.startsWith('color:')) state.setShapeColor(shape.id, id.slice(6))
      else if (id === 'delete') state.removeAnnotations([shape.id])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasApi],
  )

  const showConnectorMenu = useCallback(
    async (c: CanvasConnectorState) => {
      const id = await window.electronAPI?.showContextMenu?.([
        { id: 'label', label: c.label ? 'Edit Label' : 'Add Label' },
        { id: 'dashed', label: c.dashed ? 'Solid Line' : 'Dashed Line' },
        {
          label: 'Color',
          submenu: ANNOTATION_COLORS.map((col) => ({
            id: `color:${col.value}`,
            label: `${col.name}${c.color === col.value ? '  ✓' : ''}`,
          })),
        },
        { type: 'separator' as const },
        { id: 'delete', label: 'Delete' },
      ])
      const state = canvasApi.getState()
      if (!id) return
      if (id === 'label') beginConnectorLabelEdit(c)
      else if (id === 'dashed') state.setConnectorDashed(c.id, !c.dashed)
      else if (id.startsWith('color:')) state.setConnectorColor(c.id, id.slice(6))
      else if (id === 'delete') state.removeAnnotations([c.id])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasApi],
  )

  // --- Label editing ---------------------------------------------------------
  const beginShapeLabelEdit = useCallback((shape: CanvasShapeState) => {
    setEditing({
      kind: 'shape',
      id: shape.id,
      at: rectCenter({ origin: shape.origin, size: shape.size }),
      width: Math.max(shape.size.width - 24, 80),
    })
  }, [])

  const beginConnectorLabelEdit = useCallback(
    (c: CanvasConnectorState) => {
      const state = canvasApi.getState()
      const line = connectorLine(c.from, c.to, state.nodes, state.shapes)
      if (!line) return
      setEditing({
        kind: 'connector',
        id: c.id,
        at: { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 },
      })
    },
    [canvasApi],
  )

  // Close the editor if its target disappears (deleted from another path).
  useEffect(() => {
    if (!editing) return
    const exists = editing.kind === 'shape' ? shapes[editing.id] : connectors[editing.id]
    if (!exists) setEditing(null)
  }, [editing, shapes, connectors])

  const shapeList = Object.values(shapes).sort((a, b) => a.creationIndex - b.creationIndex)
  const connectorList = Object.values(connectors).sort((a, b) => a.creationIndex - b.creationIndex)
  if (shapeList.length === 0 && connectorList.length === 0) return null

  const selected = new Set(selection)

  return (
    <>
      <svg
        data-annotation-layer
        style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* Shapes (below connectors so an arrow into a shape stays visible). */}
        {shapeList.map((s) => {
          const isSel = selected.has(s.id)
          const common = {
            fill: fillFor(s.color),
            stroke: s.color,
            strokeWidth: isSel ? 2.5 : 1.5,
            style: { pointerEvents: 'auto' as const, cursor: 'move' },
            'data-annotation-id': s.id,
            onMouseDown: (e: React.MouseEvent) => handleShapeMouseDown(e, s),
            onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); beginShapeLabelEdit(s) },
            onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); void showShapeMenu(s) },
          }
          return (
            <g key={s.id}>
              {s.kind === 'rect' ? (
                <rect x={s.origin.x} y={s.origin.y} width={s.size.width} height={s.size.height} rx={10} {...common} />
              ) : (
                <ellipse
                  cx={s.origin.x + s.size.width / 2}
                  cy={s.origin.y + s.size.height / 2}
                  rx={s.size.width / 2}
                  ry={s.size.height / 2}
                  {...common}
                />
              )}
              {isSel && (
                <rect
                  x={s.origin.x - 4}
                  y={s.origin.y - 4}
                  width={s.size.width + 8}
                  height={s.size.height + 8}
                  rx={12}
                  fill="none"
                  stroke={SELECTION_COLOR}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}
              {s.label && !(editing?.kind === 'shape' && editing.id === s.id) && (
                <text
                  x={s.origin.x + s.size.width / 2}
                  y={s.origin.y + s.size.height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--text-primary)"
                  style={{ fontSize: 13, fontFamily: 'var(--font-sans)', pointerEvents: 'none', userSelect: 'none' }}
                >
                  {s.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Connectors — re-routed live from their endpoints' current rects. */}
        {connectorList.map((c) => {
          const line = connectorLine(c.from, c.to, nodes, shapes)
          if (!line) return null
          const isSel = selected.has(c.id)
          const mid = { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 }
          return (
            <g key={c.id} data-annotation-id={c.id}>
              {/* Fat invisible hit area so a 1.5px line is clickable. */}
              <line
                x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y}
                stroke="transparent"
                strokeWidth={14}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onMouseDown={(e) => {
                  if (e.button === 2) { e.stopPropagation(); return }
                  if (e.button !== 0) return
                  e.stopPropagation()
                  selectOne(c.id, e.shiftKey)
                }}
                onDoubleClick={(e) => { e.stopPropagation(); beginConnectorLabelEdit(c) }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); void showConnectorMenu(c) }}
              />
              <line
                x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y}
                stroke={c.color}
                strokeWidth={isSel ? 2.5 : 1.5}
                strokeDasharray={c.dashed ? '7 5' : undefined}
                pointerEvents="none"
              />
              <polygon points={arrowheadPoints(line.from, line.to, ARROW_SIZE)} fill={c.color} pointerEvents="none" />
              {c.label && !(editing?.kind === 'connector' && editing.id === c.id) && (
                <text
                  x={mid.x}
                  y={mid.y - 8}
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  stroke="var(--surface-0)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  style={{ fontSize: 12, fontFamily: 'var(--font-sans)', pointerEvents: 'none', userSelect: 'none' }}
                >
                  {c.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Resize handles for a single selected shape. */}
        {selection.length === 1 && shapes[selection[0]] && (() => {
          const s = shapes[selection[0]]
          const corners = [
            { key: 'nw' as const, x: s.origin.x, y: s.origin.y, cursor: 'nwse-resize' },
            { key: 'ne' as const, x: s.origin.x + s.size.width, y: s.origin.y, cursor: 'nesw-resize' },
            { key: 'sw' as const, x: s.origin.x, y: s.origin.y + s.size.height, cursor: 'nesw-resize' },
            { key: 'se' as const, x: s.origin.x + s.size.width, y: s.origin.y + s.size.height, cursor: 'nwse-resize' },
          ]
          return corners.map((corner) => (
            <rect
              key={corner.key}
              x={corner.x - 5}
              y={corner.y - 5}
              width={10}
              height={10}
              rx={2}
              fill="var(--surface-0)"
              stroke={SELECTION_COLOR}
              strokeWidth={1.5}
              style={{ pointerEvents: 'auto', cursor: corner.cursor }}
              data-annotation-id={s.id}
              onMouseDown={(e) => handleResizeMouseDown(e, s, corner.key)}
            />
          ))
        })()}
      </svg>

      {/* Inline label editor — world-space input centered on the target. */}
      {editing && (
        <LabelEditor
          key={`${editing.kind}:${editing.id}`}
          editing={editing}
          initial={
            editing.kind === 'shape'
              ? shapes[editing.id]?.label ?? ''
              : connectors[editing.id]?.label ?? ''
          }
          onCommit={(value) => {
            const state = canvasApi.getState()
            if (editing.kind === 'shape') state.setShapeLabel(editing.id, value.trim())
            else state.setConnectorLabel(editing.id, value.trim())
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  )
}

const LabelEditor: React.FC<{
  editing: Editing
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}> = ({ editing, initial, onCommit, onCancel }) => {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      data-annotation-id={editing.id}
      defaultValue={initial}
      placeholder="Label"
      style={{
        position: 'absolute',
        left: editing.at.x,
        top: editing.at.y,
        transform: 'translate(-50%, -50%)',
        width: editing.kind === 'shape' ? editing.width : 160,
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid var(--border-strong)',
        background: 'var(--surface-0)',
        color: 'var(--text-primary)',
        fontSize: 13,
        fontFamily: 'var(--font-sans)',
        textAlign: 'center',
        outline: 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit((e.target as HTMLInputElement).value)
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={(e) => onCommit(e.target.value)}
    />
  )
}

export default React.memo(AnnotationLayer)
