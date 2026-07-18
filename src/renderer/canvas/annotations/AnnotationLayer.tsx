// =============================================================================
// AnnotationLayer — world-space SVG rendering + direct manipulation for canvas
// shapes (rect / ellipse / sticky note) and connectors. Mounted inside the
// world div BEFORE the panel nodes, so annotations always paint underneath
// panels.
//
// Everything renders in canvas units and scales with the world transform (like
// a real drawing), so this component never subscribes to zoom/offset — it only
// re-renders when annotations, node geometry (for connector re-routing), or
// the annotation selection change.
//
// Gestures owned here:
//   shape drag    — moves the shape + everything spatially inside it (frame
//                   semantics; see shapeMembers) with edge/center snapping
//                   against the rest of the canvas (feeds SnapGuides)
//   shape resize  — corner handles on the single selected shape
//   connector drag— moves a connector's FREE POINT endpoints (anchored ends
//                   stay put; a fully-anchored connector just selects)
//   label editing — single-line input for rect/ellipse labels, multiline
//                   textarea for sticky-note text
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStoreContext, useCanvasStoreApi } from '../../stores/CanvasStoreContext'
import { connectorLine, arrowheadPoints, rectCenter, shapeMembers, snapRectToTargets } from './annotationGeometry'
import { ANNOTATION_COLORS } from '../../../shared/types'
import type { CanvasShapeState, CanvasConnectorState, Point, Rect } from '../../../shared/types'

const SELECTION_COLOR = 'rgba(74, 158, 255, 0.9)'
const ARROW_SIZE = 12
const SNAP_THRESHOLD_PX = 8

type Editing =
  | { kind: 'shape'; id: string; at: Point; width: number }
  | { kind: 'note'; id: string; rect: Rect }
  | { kind: 'connector'; id: string; at: Point }

/** Fill for a shape: notes are a solid tinted card; rect/ellipse mix the
 *  accent into transparency at the shape's fill strength. */
function fillFor(s: CanvasShapeState): string {
  if (s.kind === 'note') return `color-mix(in srgb, ${s.color} 30%, var(--surface-0))`
  const pct = Math.round((s.fillOpacity ?? 0.14) * 100)
  return pct <= 0 ? 'transparent' : `color-mix(in srgb, ${s.color} ${pct}%, transparent)`
}

function strokeWidthFor(s: CanvasShapeState, selected: boolean): number {
  return (s.strokeWidth ?? 1.5) + (selected ? 1 : 0)
}

/** Where a shape's label anchors: rects read as frames, so their label sits at
 *  the top inside the border (out of the way of contained panels); ellipses
 *  keep it centered. Notes render their text as a wrapped block, not here. */
function shapeLabelPos(s: CanvasShapeState): Point {
  return s.kind === 'rect'
    ? { x: s.origin.x + s.size.width / 2, y: s.origin.y + 18 }
    : rectCenter({ origin: s.origin, size: s.size })
}

const AnnotationLayer: React.FC = () => {
  const canvasApi = useCanvasStoreApi()
  const shapes = useCanvasStoreContext((s) => s.shapes)
  const connectors = useCanvasStoreContext((s) => s.connectors)
  const nodes = useCanvasStoreContext((s) => s.nodes)
  const selection = useCanvasStoreContext((s) => s.annotationSelection)
  const dropTargetShapeId = useCanvasStoreContext((s) => s.dropTargetShapeId)
  const pendingEdit = useCanvasStoreContext((s) => s.pendingAnnotationEdit)
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

  // --- Label / note editing --------------------------------------------------
  const beginShapeLabelEdit = useCallback((shape: CanvasShapeState) => {
    if (shape.kind === 'note') {
      setEditing({ kind: 'note', id: shape.id, rect: { origin: { ...shape.origin }, size: { ...shape.size } } })
      return
    }
    setEditing({
      kind: 'shape',
      id: shape.id,
      at: shapeLabelPos(shape),
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

  // A freshly-created note (draw overlay) opens its editor immediately.
  useEffect(() => {
    if (!pendingEdit) return
    const shape = canvasApi.getState().shapes[pendingEdit]
    canvasApi.getState().setPendingAnnotationEdit(null)
    if (shape) beginShapeLabelEdit(shape)
  }, [pendingEdit, canvasApi, beginShapeLabelEdit])

  // --- Shape drag (move + frame containment + snapping) ----------------------
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
      // Frame semantics: everything spatially inside a moving shape moves with
      // it — panel nodes, smaller shapes, and free connector points alike.
      // Membership is captured ONCE at gesture start so dragging out of/over
      // other content mid-gesture doesn't re-parent anything.
      const movingShapeSet = new Set(movingIds)
      const memberNodeIds = new Set<string>()
      for (const id of movingIds) {
        const members = shapeMembers(state.shapes[id], state.nodes, state.shapes)
        for (const nid of members.nodeIds) memberNodeIds.add(nid)
        for (const sid of members.shapeIds) movingShapeSet.add(sid)
      }
      const startOrigins = new Map(
        [...movingShapeSet].map((id) => [id, { ...state.shapes[id].origin }]),
      )
      const startNodeOrigins = new Map(
        [...memberNodeIds]
          .filter((id) => state.nodes[id])
          .map((id) => [id, { ...state.nodes[id].origin }]),
      )
      // Free connector points inside a moving container travel along.
      const inMoving = (p: Point) =>
        [...movingShapeSet].some((id) => {
          const s = state.shapes[id]
          return s && s.kind !== 'note' &&
            p.x >= s.origin.x && p.x <= s.origin.x + s.size.width &&
            p.y >= s.origin.y && p.y <= s.origin.y + s.size.height
        })
      const startConnectorPoints = new Map<string, { from?: Point; to?: Point }>()
      for (const c of Object.values(state.connectors)) {
        const entry: { from?: Point; to?: Point } = {}
        if (c.from.kind === 'point' && inMoving(c.from.point)) entry.from = { ...c.from.point }
        if (c.to.kind === 'point' && inMoving(c.to.point)) entry.to = { ...c.to.point }
        if (entry.from || entry.to) startConnectorPoints.set(c.id, entry)
      }
      // Snap targets: everything that is NOT moving.
      const snapTargets: Rect[] = [
        ...Object.values(state.nodes)
          .filter((n) => !memberNodeIds.has(n.id))
          .map((n) => ({ origin: n.origin, size: n.size })),
        ...Object.values(state.shapes)
          .filter((s) => !movingShapeSet.has(s.id))
          .map((s) => ({ origin: s.origin, size: s.size })),
      ]
      const leadStart = startOrigins.get(shape.id)!
      let moved = false
      draggedRef.current = false

      const onMove = (ev: MouseEvent) => {
        const rawDx = ev.clientX - startX
        const rawDy = ev.clientY - startY
        if (!moved && Math.hypot(rawDx, rawDy) < 3) return
        if (!moved) {
          moved = true
          draggedRef.current = true
          // One undo step per drag gesture, mirroring node moves. The snapshot
          // carries nodes too, so member-node moves undo with it.
          canvasApi.getState().pushHistory()
        }
        const zoom = canvasApi.getState().zoomLevel
        let dx = rawDx / zoom
        let dy = rawDy / zoom
        // Snap the LEAD shape's edges/centers; the whole group follows the
        // adjusted delta so relative positions inside the group are preserved.
        // Alt disables snapping (matching the grid-snap convention).
        if (!ev.altKey) {
          const snapped = snapRectToTargets(
            { x: leadStart.x + dx, y: leadStart.y + dy },
            shape.size,
            snapTargets,
            SNAP_THRESHOLD_PX / zoom,
          )
          dx += snapped.origin.x - (leadStart.x + dx)
          dy += snapped.origin.y - (leadStart.y + dy)
          canvasApi.getState().setSnapGuides({ lines: snapped.lines })
        } else {
          canvasApi.getState().clearSnapGuides()
        }
        for (const [id, o] of startOrigins) {
          canvasApi.getState().updateShapeGeometry(id, { x: o.x + dx, y: o.y + dy })
        }
        for (const [id, o] of startNodeOrigins) {
          canvasApi.getState().moveNode(id, { x: o.x + dx, y: o.y + dy })
        }
        for (const [id, pts] of startConnectorPoints) {
          canvasApi.getState().updateConnectorPoints(
            id,
            pts.from ? { x: pts.from.x + dx, y: pts.from.y + dy } : undefined,
            pts.to ? { x: pts.to.x + dx, y: pts.to.y + dy } : undefined,
          )
        }
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        canvasApi.getState().clearSnapGuides()
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [canvasApi, selectOne],
  )

  // --- Connector mousedown: select + drag free point endpoints ----------------
  const handleConnectorMouseDown = useCallback(
    (e: React.MouseEvent, c: CanvasConnectorState) => {
      if (e.button === 2) { e.stopPropagation(); return }
      if (e.button !== 0) return
      e.stopPropagation()
      selectOne(c.id, e.shiftKey)
      if (e.shiftKey) return
      const hasPoints = c.from.kind === 'point' || c.to.kind === 'point'
      if (!hasPoints) return
      const startX = e.clientX
      const startY = e.clientY
      const startFrom = c.from.kind === 'point' ? { ...c.from.point } : null
      const startTo = c.to.kind === 'point' ? { ...c.to.point } : null
      let moved = false
      const onMove = (ev: MouseEvent) => {
        const dxPx = ev.clientX - startX
        const dyPx = ev.clientY - startY
        if (!moved && Math.hypot(dxPx, dyPx) < 3) return
        if (!moved) {
          moved = true
          draggedRef.current = true
          canvasApi.getState().pushHistory()
        }
        const zoom = canvasApi.getState().zoomLevel
        const dx = dxPx / zoom
        const dy = dyPx / zoom
        canvasApi.getState().updateConnectorPoints(
          c.id,
          startFrom ? { x: startFrom.x + dx, y: startFrom.y + dy } : undefined,
          startTo ? { x: startTo.x + dx, y: startTo.y + dy } : undefined,
        )
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
      const isNote = shape.kind === 'note'
      const fill = shape.fillOpacity ?? 0.14
      const stroke = shape.strokeWidth ?? 1.5
      const items: unknown[] = [
        { id: 'label', label: shape.label ? (isNote ? 'Edit Text' : 'Edit Label') : (isNote ? 'Add Text' : 'Add Label') },
        {
          label: 'Shape',
          submenu: [
            { id: 'kind:rect', label: `Rectangle${shape.kind === 'rect' ? '  ✓' : ''}` },
            { id: 'kind:ellipse', label: `Ellipse${shape.kind === 'ellipse' ? '  ✓' : ''}` },
            { id: 'kind:note', label: `Sticky Note${isNote ? '  ✓' : ''}` },
          ],
        },
        {
          label: 'Color',
          submenu: ANNOTATION_COLORS.map((c) => ({
            id: `color:${c.value}`,
            label: `${c.name}${shape.color === c.value ? '  ✓' : ''}`,
          })),
        },
      ]
      if (!isNote) {
        items.push(
          {
            label: 'Fill',
            submenu: [
              { id: 'fill:0', label: `None${fill === 0 ? '  ✓' : ''}` },
              { id: 'fill:0.14', label: `Subtle${fill === 0.14 ? '  ✓' : ''}` },
              { id: 'fill:0.35', label: `Strong${fill === 0.35 ? '  ✓' : ''}` },
            ],
          },
          {
            label: 'Border',
            submenu: [
              { id: 'stroke:1', label: `Thin${stroke === 1 ? '  ✓' : ''}` },
              { id: 'stroke:1.5', label: `Normal${stroke === 1.5 ? '  ✓' : ''}` },
              { id: 'stroke:3', label: `Bold${stroke === 3 ? '  ✓' : ''}` },
            ],
          },
        )
      }
      items.push(
        { type: 'separator' as const },
        { id: 'duplicate', label: 'Duplicate' },
        { id: 'front', label: 'Bring to Front' },
        { id: 'back', label: 'Send to Back' },
        { type: 'separator' as const },
        { id: 'delete', label: 'Delete' },
      )
      const id = await window.electronAPI?.showContextMenu?.(items as never)
      const state = canvasApi.getState()
      if (!id) return
      if (id === 'label') beginShapeLabelEdit(state.shapes[shape.id] ?? shape)
      else if (id.startsWith('kind:')) state.setShapeKind(shape.id, id.slice(5) as CanvasShapeState['kind'])
      else if (id.startsWith('color:')) state.setShapeColor(shape.id, id.slice(6))
      else if (id.startsWith('fill:')) state.setShapeFill(shape.id, Number(id.slice(5)))
      else if (id.startsWith('stroke:')) state.setShapeStrokeWidth(shape.id, Number(id.slice(7)))
      else if (id === 'duplicate') state.duplicateAnnotations([shape.id])
      else if (id === 'front') state.bringShapeToFront(shape.id)
      else if (id === 'back') state.sendShapeToBack(shape.id)
      else if (id === 'delete') state.removeAnnotations([shape.id])
    },
    [canvasApi, beginShapeLabelEdit],
  )

  const showConnectorMenu = useCallback(
    async (c: CanvasConnectorState) => {
      const arrows = c.arrows ?? 'end'
      const id = await window.electronAPI?.showContextMenu?.([
        { id: 'label', label: c.label ? 'Edit Label' : 'Add Label' },
        { id: 'dashed', label: c.dashed ? 'Solid Line' : 'Dashed Line' },
        { id: 'reverse', label: 'Reverse Direction' },
        {
          label: 'Arrowheads',
          submenu: [
            { id: 'arrows:end', label: `End${arrows === 'end' ? '  ✓' : ''}` },
            { id: 'arrows:both', label: `Both${arrows === 'both' ? '  ✓' : ''}` },
            { id: 'arrows:none', label: `None${arrows === 'none' ? '  ✓' : ''}` },
          ],
        },
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
      else if (id === 'reverse') state.reverseConnector(c.id)
      else if (id.startsWith('arrows:')) state.setConnectorArrows(c.id, id.slice(7) as 'end' | 'both' | 'none')
      else if (id.startsWith('color:')) state.setConnectorColor(c.id, id.slice(6))
      else if (id === 'delete') state.removeAnnotations([c.id])
    },
    [canvasApi, beginConnectorLabelEdit],
  )

  // Close the editor if its target disappears (deleted from another path).
  useEffect(() => {
    if (!editing) return
    const exists = editing.kind === 'connector' ? connectors[editing.id] : shapes[editing.id]
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
          const isDropTarget = dropTargetShapeId === s.id
          const common = {
            fill: fillFor(s),
            stroke: s.color,
            strokeWidth: strokeWidthFor(s, isSel),
            style: {
              pointerEvents: 'auto' as const,
              cursor: 'move',
              ...(s.kind === 'note' ? { filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))' } : {}),
            },
            'data-annotation-id': s.id,
            onMouseDown: (e: React.MouseEvent) => handleShapeMouseDown(e, s),
            onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); beginShapeLabelEdit(s) },
            onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); void showShapeMenu(s) },
          }
          return (
            <g key={s.id}>
              {s.kind === 'ellipse' ? (
                <ellipse
                  cx={s.origin.x + s.size.width / 2}
                  cy={s.origin.y + s.size.height / 2}
                  rx={s.size.width / 2}
                  ry={s.size.height / 2}
                  {...common}
                />
              ) : (
                <rect
                  x={s.origin.x} y={s.origin.y}
                  width={s.size.width} height={s.size.height}
                  rx={s.kind === 'note' ? 6 : 10}
                  {...common}
                />
              )}
              {(isSel || isDropTarget) && (
                <rect
                  x={s.origin.x - 4}
                  y={s.origin.y - 4}
                  width={s.size.width + 8}
                  height={s.size.height + 8}
                  rx={12}
                  fill="none"
                  stroke={SELECTION_COLOR}
                  strokeWidth={isDropTarget ? 2 : 1}
                  strokeDasharray={isDropTarget ? undefined : '4 3'}
                  pointerEvents="none"
                />
              )}
              {/* Sticky-note text: wrapped block via foreignObject. */}
              {s.kind === 'note' && s.label && !(editing?.kind === 'note' && editing.id === s.id) && (
                <foreignObject
                  x={s.origin.x} y={s.origin.y}
                  width={s.size.width} height={s.size.height}
                  pointerEvents="none"
                >
                  <div
                    data-annotation-content
                    style={{
                      width: '100%', height: '100%', padding: '10px 12px',
                      fontSize: 13, lineHeight: 1.45, fontFamily: 'var(--font-sans)',
                      color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
                      overflow: 'hidden', wordBreak: 'break-word', userSelect: 'none',
                    }}
                  >
                    {s.label}
                  </div>
                </foreignObject>
              )}
              {s.kind !== 'note' && s.label && !(editing?.kind === 'shape' && editing.id === s.id) && (
                <text
                  x={shapeLabelPos(s).x}
                  y={shapeLabelPos(s).y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--text-primary)"
                  style={{ fontSize: 13, fontWeight: s.kind === 'rect' ? 600 : 400, fontFamily: 'var(--font-sans)', pointerEvents: 'none', userSelect: 'none' }}
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
          const hasPoints = c.from.kind === 'point' || c.to.kind === 'point'
          return (
            <g key={c.id} data-annotation-id={c.id}>
              {/* Fat invisible hit area so a 1.5px line is clickable. */}
              <line
                x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y}
                stroke="transparent"
                strokeWidth={14}
                style={{ pointerEvents: 'stroke', cursor: hasPoints ? 'move' : 'pointer' }}
                onMouseDown={(e) => handleConnectorMouseDown(e, c)}
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
              {(c.arrows ?? 'end') !== 'none' && (
                <polygon points={arrowheadPoints(line.from, line.to, ARROW_SIZE)} fill={c.color} pointerEvents="none" />
              )}
              {c.arrows === 'both' && (
                <polygon points={arrowheadPoints(line.to, line.from, ARROW_SIZE)} fill={c.color} pointerEvents="none" />
              )}
              {/* Free endpoints show a grabbable dot when selected. */}
              {isSel && c.from.kind === 'point' && (
                <circle cx={line.from.x} cy={line.from.y} r={4} fill={SELECTION_COLOR} pointerEvents="none" />
              )}
              {isSel && c.to.kind === 'point' && (
                <circle cx={line.to.x} cy={line.to.y} r={4} fill={SELECTION_COLOR} pointerEvents="none" />
              )}
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

      {/* Inline single-line label editor (rect/ellipse/connector). */}
      {editing && editing.kind !== 'note' && (
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

      {/* Sticky-note multiline text editor, covering the note card. */}
      {editing && editing.kind === 'note' && (
        <NoteEditor
          key={`note:${editing.id}`}
          rect={editing.rect}
          color={shapes[editing.id]?.color ?? ANNOTATION_COLORS[3].value}
          initial={shapes[editing.id]?.label ?? ''}
          onCommit={(value) => {
            canvasApi.getState().setShapeLabel(editing.id, value.replace(/\s+$/, ''))
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  )
}

const LabelEditor: React.FC<{
  editing: Extract<Editing, { kind: 'shape' | 'connector' }>
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

const NoteEditor: React.FC<{
  rect: Rect
  color: string
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}> = ({ rect, color, initial, onCommit, onCancel }) => {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <textarea
      ref={ref}
      data-annotation-content
      defaultValue={initial}
      placeholder="Type a note…"
      style={{
        position: 'absolute',
        left: rect.origin.x,
        top: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
        padding: '10px 12px',
        borderRadius: 6,
        border: `1.5px solid ${color}`,
        background: `color-mix(in srgb, ${color} 30%, var(--surface-0))`,
        color: 'var(--text-primary)',
        fontSize: 13,
        lineHeight: 1.45,
        fontFamily: 'var(--font-sans)',
        resize: 'none',
        outline: 'none',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        // Enter inserts newlines; Cmd/Ctrl+Enter commits, Esc cancels.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit((e.target as HTMLTextAreaElement).value)
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={(e) => onCommit(e.target.value)}
    />
  )
}

export default React.memo(AnnotationLayer)
