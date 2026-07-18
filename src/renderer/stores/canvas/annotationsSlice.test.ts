// =============================================================================
// Annotations (shapes + connectors) — store behavior: selection exclusivity,
// connector lifecycle tied to its endpoints, undo/redo, and load sanitizing.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createCanvasStore } from '../canvasStore'
import type { CanvasAnnotations } from '../../../shared/types'

function storeWithNode(panelId = 'p1') {
  const store = createCanvasStore()
  const nodeId = store.getState().addNode(panelId, 'editor', { x: 0, y: 0 }, { width: 100, height: 80 })
  return { store, nodeId }
}

describe('annotations slice', () => {
  it('addShape selects the shape and clears node selection (mutually exclusive)', () => {
    const { store, nodeId } = storeWithNode()
    store.getState().selectNodes([nodeId])
    const shapeId = store.getState().addShape('rect', { x: 10, y: 10 })
    expect(store.getState().annotationSelection).toEqual([shapeId])
    expect(store.getState().selection).toEqual([])
  })

  it('selecting a node clears the annotation selection', () => {
    const { store, nodeId } = storeWithNode()
    const shapeId = store.getState().addShape('rect', { x: 10, y: 10 })
    expect(store.getState().annotationSelection).toEqual([shapeId])
    store.getState().focusNode(nodeId)
    expect(store.getState().annotationSelection).toEqual([])
    expect(store.getState().selection).toEqual([nodeId])
  })

  it('addConnector refuses identical endpoints and exact duplicates (either direction)', () => {
    const { store, nodeId } = storeWithNode()
    const shapeId = store.getState().addShape('rect', { x: 300, y: 0 })
    expect(store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'node', nodeId })).toBeNull()
    const c1 = store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'shape', shapeId })
    expect(c1).not.toBeNull()
    expect(store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'shape', shapeId })).toBeNull()
    expect(store.getState().addConnector({ kind: 'shape', shapeId }, { kind: 'node', nodeId })).toBeNull()
  })

  it('addConnector refuses endpoints that do not resolve', () => {
    const { store, nodeId } = storeWithNode()
    expect(store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'shape', shapeId: 'ghost' })).toBeNull()
  })

  it('removing a shape removes connectors attached to it', () => {
    const { store, nodeId } = storeWithNode()
    const shapeId = store.getState().addShape('ellipse', { x: 300, y: 0 })
    const cId = store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'shape', shapeId })!
    store.getState().removeAnnotations([shapeId])
    expect(store.getState().shapes[shapeId]).toBeUndefined()
    expect(store.getState().connectors[cId]).toBeUndefined()
  })

  it('finalizeRemoveNode removes connectors anchored to the node', () => {
    const { store, nodeId } = storeWithNode()
    const shapeId = store.getState().addShape('rect', { x: 300, y: 0 })
    const cId = store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'shape', shapeId })!
    store.getState().finalizeRemoveNode(nodeId)
    expect(store.getState().connectors[cId]).toBeUndefined()
    expect(store.getState().shapes[shapeId]).toBeDefined()
  })

  it('undo restores a deleted shape and its connector; redo removes them again', () => {
    const { store, nodeId } = storeWithNode()
    const shapeId = store.getState().addShape('rect', { x: 300, y: 0 })
    const cId = store.getState().addConnector({ kind: 'node', nodeId }, { kind: 'shape', shapeId })!
    store.getState().removeAnnotations([shapeId])
    expect(store.getState().connectors[cId]).toBeUndefined()

    store.getState().undo()
    expect(store.getState().shapes[shapeId]).toBeDefined()
    expect(store.getState().connectors[cId]).toBeDefined()

    store.getState().redo()
    expect(store.getState().shapes[shapeId]).toBeUndefined()
    expect(store.getState().connectors[cId]).toBeUndefined()
  })

  it('history transaction commits when only annotations changed', () => {
    const { store } = storeWithNode()
    const before = store.getState().history.length
    store.getState().beginHistoryTransaction()
    store.getState().addShape('rect', { x: 0, y: 0 }) // its own pushHistory is suppressed by the tx
    store.getState().commitHistoryTransaction()
    expect(store.getState().history.length).toBe(before + 1)
  })

  it('loadWorkspaceCanvas round-trips annotations and drops corrupt/dangling entries', () => {
    const store = createCanvasStore()
    const annotations = {
      shapes: {
        good: { id: 'good', kind: 'rect', origin: { x: 1, y: 2 }, size: { width: 100, height: 60 }, color: '#4a9eff', creationIndex: 0 },
        corrupt: { id: 'corrupt', kind: 'rect', origin: { x: Number.NaN, y: 0 }, size: { width: 10, height: 10 }, color: '#fff', creationIndex: 1 },
      },
      connectors: {
        ok: { id: 'ok', from: { kind: 'shape', shapeId: 'good' }, to: { kind: 'node', nodeId: 'n1' }, color: '#4a9eff', creationIndex: 2 },
        dangling: { id: 'dangling', from: { kind: 'shape', shapeId: 'corrupt' }, to: { kind: 'shape', shapeId: 'good' }, color: '#4a9eff', creationIndex: 3 },
      },
    } as unknown as CanvasAnnotations
    const nodes = {
      n1: {
        id: 'n1', origin: { x: 500, y: 0 }, size: { width: 100, height: 80 }, zOrder: 0, creationIndex: 0,
        dockLayout: { type: 'tabs' as const, id: 't1', panelIds: ['p1'], activeIndex: 0 },
      },
    }
    store.getState().loadWorkspaceCanvas(nodes, { x: 0, y: 0 }, 1, annotations)
    const s = store.getState()
    expect(Object.keys(s.shapes)).toEqual(['good'])
    expect(Object.keys(s.connectors)).toEqual(['ok'])
    // Counters advance past loaded annotation creation indices.
    expect(s.nextCreationIndex).toBe(3)
  })

  it('label/color edits are undoable', () => {
    const store = createCanvasStore()
    const shapeId = store.getState().addShape('rect', { x: 0, y: 0 })
    store.getState().setShapeLabel(shapeId, 'API layer')
    expect(store.getState().shapes[shapeId].label).toBe('API layer')
    store.getState().undo()
    expect(store.getState().shapes[shapeId].label).toBeUndefined()
  })

  it('duplicateAnnotations clones a shape group with its internal wiring remapped', () => {
    const store = createCanvasStore()
    const a = store.getState().addShape('rect', { x: 0, y: 0 })
    const b = store.getState().addShape('ellipse', { x: 400, y: 0 })
    store.getState().setShapeLabel(a, 'src')
    const c = store.getState().addConnector({ kind: 'shape', shapeId: a }, { kind: 'shape', shapeId: b })!
    const clones = store.getState().duplicateAnnotations([a, b])
    const s = store.getState()
    // 2 shape clones + the internal connector cloned along.
    expect(clones.length).toBe(3)
    expect(Object.keys(s.shapes).length).toBe(4)
    expect(Object.keys(s.connectors).length).toBe(2)
    const cloneConn = Object.values(s.connectors).find((x) => x.id !== c)!
    // Remapped onto the clones, not the originals.
    expect(cloneConn.from).not.toEqual({ kind: 'shape', shapeId: a })
    expect(s.shapes[(cloneConn.from as { shapeId: string }).shapeId]).toBeDefined()
    // Clones are offset and selected; label carried over.
    const cloneA = Object.values(s.shapes).find((x) => x.label === 'src' && x.id !== a)!
    expect(cloneA.origin).toEqual({ x: 28, y: 28 })
    expect(new Set(s.annotationSelection)).toEqual(new Set(clones))
    // One undo removes the whole duplication.
    store.getState().undo()
    expect(Object.keys(store.getState().shapes).length).toBe(2)
    expect(Object.keys(store.getState().connectors).length).toBe(1)
  })

  it('duplicating a shape wired to a node keeps the clone attached to that node', () => {
    const { store, nodeId } = storeWithNode()
    const a = store.getState().addShape('rect', { x: 400, y: 0 })
    store.getState().addConnector({ kind: 'shape', shapeId: a }, { kind: 'node', nodeId })
    const clones = store.getState().duplicateAnnotations([a])
    const s = store.getState()
    expect(Object.keys(s.connectors).length).toBe(1) // node-attached connector not auto-cloned
    expect(clones.length).toBe(1)
  })

  it('bring/send reorders shapes within the shape stack', () => {
    const store = createCanvasStore()
    const a = store.getState().addShape('rect', { x: 0, y: 0 })
    const b = store.getState().addShape('rect', { x: 10, y: 10 })
    expect(store.getState().shapes[b].creationIndex).toBeGreaterThan(store.getState().shapes[a].creationIndex)
    store.getState().bringShapeToFront(a)
    expect(store.getState().shapes[a].creationIndex).toBeGreaterThan(store.getState().shapes[b].creationIndex)
    store.getState().sendShapeToBack(a)
    expect(store.getState().shapes[a].creationIndex).toBeLessThan(store.getState().shapes[b].creationIndex)
  })

  it('reverseConnector swaps direction and setConnectorArrows round-trips', () => {
    const { store, nodeId } = storeWithNode()
    const a = store.getState().addShape('rect', { x: 400, y: 0 })
    const c = store.getState().addConnector({ kind: 'shape', shapeId: a }, { kind: 'node', nodeId })!
    store.getState().reverseConnector(c)
    expect(store.getState().connectors[c].from).toEqual({ kind: 'node', nodeId })
    store.getState().setConnectorArrows(c, 'both')
    expect(store.getState().connectors[c].arrows).toBe('both')
    store.getState().setConnectorArrows(c, 'end')
    expect(store.getState().connectors[c].arrows).toBeUndefined()
  })
})
