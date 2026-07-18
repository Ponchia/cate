// =============================================================================
// Annotations slice — shapes + connectors drawn on the canvas.
//
// Annotations are pure canvas-store state (no panel records, no dock
// membership): shapes are rects/ellipses with an optional label; connectors
// anchor to a node or shape BY ID and re-route as their endpoints move.
// Structural mutations (add/remove) push undo history exactly like node
// add/remove; geometry updates during a drag do not (the initiating gesture
// pushes once at drag start, mirroring node moves).
//
// Selection is a separate id list from the node `selection` — the two are
// mutually exclusive (selecting an annotation clears node selection and vice
// versa) so Delete/Escape always act on exactly one kind of thing.
// =============================================================================

import type { CanvasAnnotations, CanvasConnectorEndpoint, CanvasConnectorState } from '../../../shared/types'
import { ANNOTATION_COLORS } from '../../../shared/types'
import type { CanvasGet, CanvasSet, CanvasStoreActions } from './storeTypes'
import { generateId } from './helpers'

type AnnotationsActions = Pick<
  CanvasStoreActions,
  | 'addShape'
  | 'updateShapeGeometry'
  | 'setShapeLabel'
  | 'setShapeColor'
  | 'setShapeKind'
  | 'addConnector'
  | 'setConnectorLabel'
  | 'setConnectorColor'
  | 'setConnectorDashed'
  | 'setConnectorArrows'
  | 'reverseConnector'
  | 'bringShapeToFront'
  | 'sendShapeToBack'
  | 'duplicateAnnotations'
  | 'removeAnnotations'
  | 'selectAnnotations'
  | 'clearAnnotationSelection'
  | 'setAnnotationMode'
  | 'setConnectorDraft'
>

export const SHAPE_DEFAULT_SIZE = { width: 200, height: 130 }
export const SHAPE_MIN_SIZE = { width: 40, height: 30 }

function endpointsEqual(a: CanvasConnectorEndpoint, b: CanvasConnectorEndpoint): boolean {
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId
  if (a.kind === 'shape' && b.kind === 'shape') return a.shapeId === b.shapeId
  return false
}

/** Whether an endpoint resolves against the given live state. */
function endpointExists(
  ep: CanvasConnectorEndpoint,
  nodes: Record<string, unknown>,
  shapes: Record<string, unknown>,
): boolean {
  return ep.kind === 'node' ? !!nodes[ep.nodeId] : !!shapes[ep.shapeId]
}

/** Drop connectors whose endpoints no longer resolve. Returns the same object
 *  when nothing changed so zustand equality short-circuits. */
export function pruneConnectors(
  connectors: Record<string, CanvasConnectorState>,
  nodes: Record<string, unknown>,
  shapes: Record<string, unknown>,
): Record<string, CanvasConnectorState> {
  let changed = false
  const next: typeof connectors = {}
  for (const [id, c] of Object.entries(connectors)) {
    if (endpointExists(c.from, nodes, shapes) && endpointExists(c.to, nodes, shapes)) {
      next[id] = c
    } else {
      changed = true
    }
  }
  return changed ? next : connectors
}

/** Repair/drop invalid persisted annotations (untrusted `.cate` data), so one
 *  corrupt entry can't crash the canvas render. */
export function sanitizeLoadedAnnotations(raw: CanvasAnnotations | undefined): CanvasAnnotations {
  const shapes: CanvasAnnotations['shapes'] = {}
  const connectors: CanvasAnnotations['connectors'] = {}
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  for (const [id, s] of Object.entries(raw?.shapes ?? {})) {
    if (!s || typeof s !== 'object') continue
    if (s.kind !== 'rect' && s.kind !== 'ellipse') continue
    if (!finite(s.origin?.x) || !finite(s.origin?.y) || !finite(s.size?.width) || !finite(s.size?.height)) continue
    shapes[id] = {
      id,
      kind: s.kind,
      origin: { x: s.origin.x, y: s.origin.y },
      size: {
        width: Math.max(s.size.width, SHAPE_MIN_SIZE.width),
        height: Math.max(s.size.height, SHAPE_MIN_SIZE.height),
      },
      color: typeof s.color === 'string' ? s.color : ANNOTATION_COLORS[0].value,
      label: typeof s.label === 'string' ? s.label : undefined,
      creationIndex: finite(s.creationIndex) ? s.creationIndex : 0,
    }
  }
  for (const [id, c] of Object.entries(raw?.connectors ?? {})) {
    if (!c || typeof c !== 'object') continue
    const validEp = (ep: CanvasConnectorEndpoint | undefined): ep is CanvasConnectorEndpoint =>
      !!ep && ((ep.kind === 'node' && typeof ep.nodeId === 'string') || (ep.kind === 'shape' && typeof ep.shapeId === 'string'))
    if (!validEp(c.from) || !validEp(c.to)) continue
    connectors[id] = {
      id,
      from: c.from,
      to: c.to,
      color: typeof c.color === 'string' ? c.color : ANNOTATION_COLORS[0].value,
      label: typeof c.label === 'string' ? c.label : undefined,
      dashed: c.dashed === true ? true : undefined,
      arrows: c.arrows === 'both' || c.arrows === 'none' ? c.arrows : undefined,
      creationIndex: finite(c.creationIndex) ? c.creationIndex : 0,
    }
  }
  return { shapes, connectors }
}

export function createAnnotationsSlice(set: CanvasSet, get: CanvasGet): AnnotationsActions {
  return {
    addShape(kind, origin, size, color) {
      get().pushHistory()
      const state = get()
      const id = generateId()
      const s = size ?? SHAPE_DEFAULT_SIZE
      set({
        shapes: {
          ...state.shapes,
          [id]: {
            id,
            kind,
            origin,
            size: {
              width: Math.max(s.width, SHAPE_MIN_SIZE.width),
              height: Math.max(s.height, SHAPE_MIN_SIZE.height),
            },
            color: color ?? ANNOTATION_COLORS[0].value,
            creationIndex: state.nextCreationIndex,
          },
        },
        nextCreationIndex: state.nextCreationIndex + 1,
        annotationSelection: [id],
        selection: [],
        selectionActive: false,
      })
      return id
    },

    updateShapeGeometry(id, origin, size) {
      set((state) => {
        const shape = state.shapes[id]
        if (!shape) return state
        return {
          shapes: {
            ...state.shapes,
            [id]: {
              ...shape,
              origin,
              ...(size
                ? {
                    size: {
                      width: Math.max(size.width, SHAPE_MIN_SIZE.width),
                      height: Math.max(size.height, SHAPE_MIN_SIZE.height),
                    },
                  }
                : {}),
            },
          },
        }
      })
    },

    setShapeLabel(id, label) {
      const shape = get().shapes[id]
      if (!shape || (shape.label ?? '') === label) return
      get().pushHistory()
      set((state) => ({
        shapes: { ...state.shapes, [id]: { ...shape, label: label || undefined } },
      }))
    },

    setShapeColor(id, color) {
      const shape = get().shapes[id]
      if (!shape || shape.color === color) return
      get().pushHistory()
      set((state) => ({ shapes: { ...state.shapes, [id]: { ...shape, color } } }))
    },

    setShapeKind(id, kind) {
      const shape = get().shapes[id]
      if (!shape || shape.kind === kind) return
      get().pushHistory()
      set((state) => ({ shapes: { ...state.shapes, [id]: { ...shape, kind } } }))
    },

    addConnector(from, to, color) {
      const state = get()
      if (endpointsEqual(from, to)) return null
      if (!endpointExists(from, state.nodes, state.shapes) || !endpointExists(to, state.nodes, state.shapes)) {
        return null
      }
      // Refuse an exact duplicate (same endpoints either direction) — a second
      // identical line renders invisibly on top of the first and can only
      // confuse deletion.
      for (const c of Object.values(state.connectors)) {
        if (
          (endpointsEqual(c.from, from) && endpointsEqual(c.to, to)) ||
          (endpointsEqual(c.from, to) && endpointsEqual(c.to, from))
        ) {
          return null
        }
      }
      get().pushHistory()
      const id = generateId()
      set({
        connectors: {
          ...state.connectors,
          [id]: {
            id,
            from,
            to,
            color: color ?? ANNOTATION_COLORS[0].value,
            creationIndex: state.nextCreationIndex,
          },
        },
        nextCreationIndex: state.nextCreationIndex + 1,
        annotationSelection: [id],
        selection: [],
        selectionActive: false,
      })
      return id
    },

    setConnectorLabel(id, label) {
      const c = get().connectors[id]
      if (!c || (c.label ?? '') === label) return
      get().pushHistory()
      set((state) => ({
        connectors: { ...state.connectors, [id]: { ...c, label: label || undefined } },
      }))
    },

    setConnectorColor(id, color) {
      const c = get().connectors[id]
      if (!c || c.color === color) return
      get().pushHistory()
      set((state) => ({ connectors: { ...state.connectors, [id]: { ...c, color } } }))
    },

    setConnectorDashed(id, dashed) {
      const c = get().connectors[id]
      if (!c || (c.dashed === true) === dashed) return
      get().pushHistory()
      set((state) => ({
        connectors: { ...state.connectors, [id]: { ...c, dashed: dashed || undefined } },
      }))
    },

    setConnectorArrows(id, arrows) {
      const c = get().connectors[id]
      if (!c || (c.arrows ?? 'end') === arrows) return
      get().pushHistory()
      set((state) => ({
        connectors: { ...state.connectors, [id]: { ...c, arrows: arrows === 'end' ? undefined : arrows } },
      }))
    },

    reverseConnector(id) {
      const c = get().connectors[id]
      if (!c) return
      get().pushHistory()
      set((state) => ({
        connectors: { ...state.connectors, [id]: { ...c, from: c.to, to: c.from } },
      }))
    },

    bringShapeToFront(id) {
      const state = get()
      const shape = state.shapes[id]
      if (!shape) return
      get().pushHistory()
      set({
        shapes: { ...state.shapes, [id]: { ...shape, creationIndex: state.nextCreationIndex } },
        nextCreationIndex: state.nextCreationIndex + 1,
      })
    },

    sendShapeToBack(id) {
      const state = get()
      const shape = state.shapes[id]
      if (!shape) return
      const min = Object.values(state.shapes).reduce((m, s) => Math.min(m, s.creationIndex), Infinity)
      if (shape.creationIndex === min) return
      get().pushHistory()
      set({
        shapes: { ...state.shapes, [id]: { ...shape, creationIndex: min - 1 } },
      })
    },

    duplicateAnnotations(ids) {
      const state = get()
      const shapeIds = ids.filter((id) => state.shapes[id])
      const connectorIds = ids.filter((id) => state.connectors[id])
      if (shapeIds.length === 0 && connectorIds.length === 0) return []
      get().pushHistory()
      const OFFSET = 28
      let nextIndex = state.nextCreationIndex
      const idMap = new Map<string, string>()
      const shapes = { ...state.shapes }
      for (const id of shapeIds) {
        const src = state.shapes[id]
        const cloneId = generateId()
        idMap.set(id, cloneId)
        shapes[cloneId] = {
          ...src,
          id: cloneId,
          origin: { x: src.origin.x + OFFSET, y: src.origin.y + OFFSET },
          creationIndex: nextIndex++,
        }
      }
      // Connectors: explicitly selected ones, plus those running between two
      // duplicated shapes (duplicating a group keeps its internal wiring).
      const connectors = { ...state.connectors }
      const remap = (ep: CanvasConnectorEndpoint): CanvasConnectorEndpoint =>
        ep.kind === 'shape' && idMap.has(ep.shapeId) ? { kind: 'shape', shapeId: idMap.get(ep.shapeId)! } : ep
      const coveredEnd = (ep: CanvasConnectorEndpoint): boolean =>
        ep.kind === 'node' || (ep.kind === 'shape' && idMap.has(ep.shapeId))
      const wanted = new Set(connectorIds)
      for (const c of Object.values(state.connectors)) {
        const internal = c.from.kind === 'shape' && c.to.kind === 'shape'
          && idMap.has(c.from.shapeId) && idMap.has(c.to.shapeId)
        if (!wanted.has(c.id) && !internal) continue
        // A selected connector clones only when each end still resolves after
        // remapping (a node end stays put; a shape end must be in the set).
        if (wanted.has(c.id) && !(coveredEnd(c.from) && coveredEnd(c.to))) continue
        const from = remap(c.from)
        const to = remap(c.to)
        // Unmapped both-node clone would duplicate in place invisibly — skip.
        if (from === c.from && to === c.to) continue
        const cloneId = generateId()
        idMap.set(c.id, cloneId)
        connectors[cloneId] = { ...c, id: cloneId, from, to, creationIndex: nextIndex++ }
      }
      const cloneIds = [...idMap.values()]
      set({
        shapes,
        connectors,
        nextCreationIndex: nextIndex,
        annotationSelection: cloneIds,
        selection: [],
        selectionActive: false,
      })
      return cloneIds
    },

    removeAnnotations(ids) {
      const state = get()
      const toRemove = new Set(ids.filter((id) => state.shapes[id] || state.connectors[id]))
      if (toRemove.size === 0) return
      get().pushHistory()
      const shapes: typeof state.shapes = {}
      for (const [id, s] of Object.entries(state.shapes)) {
        if (!toRemove.has(id)) shapes[id] = s
      }
      let connectors: typeof state.connectors = {}
      for (const [id, c] of Object.entries(state.connectors)) {
        if (!toRemove.has(id)) connectors[id] = c
      }
      // Connectors attached to a removed shape go with it.
      connectors = pruneConnectors(connectors, state.nodes, shapes)
      set({
        shapes,
        connectors,
        annotationSelection: state.annotationSelection.filter((id) => !toRemove.has(id)),
      })
    },

    selectAnnotations(ids, additive) {
      set((state) => {
        const valid = ids.filter((id) => state.shapes[id] || state.connectors[id])
        const next = additive
          ? [...new Set([...state.annotationSelection, ...valid])]
          : [...new Set(valid)]
        return {
          annotationSelection: next,
          // Mutually exclusive with node selection so Delete acts on one kind.
          ...(next.length > 0 ? { selection: [], selectionActive: false } : {}),
        }
      })
    },

    clearAnnotationSelection() {
      if (get().annotationSelection.length === 0) return
      set({ annotationSelection: [] })
    },

    setAnnotationMode(mode) {
      set({ annotationMode: mode, connectorDraft: null })
    },

    setConnectorDraft(endpoint) {
      set({ connectorDraft: endpoint })
    },
  }
}
