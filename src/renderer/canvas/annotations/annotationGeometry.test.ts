// =============================================================================
// Annotation geometry — anchor math and hit-testing.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  anchorPoint,
  connectorLine,
  hitTestShape,
  hitTestEndpoint,
} from './annotationGeometry'
import type { CanvasNodeState, CanvasShapeState } from '../../../shared/types'

const rectGeom = (x: number, y: number, w: number, h: number, ellipse = false) => ({
  rect: { origin: { x, y }, size: { width: w, height: h } },
  ellipse,
})

function node(id: string, x: number, y: number, w = 100, h = 80, zOrder = 0): CanvasNodeState {
  return {
    id, origin: { x, y }, size: { width: w, height: h }, zOrder, creationIndex: 0,
    dockLayout: { type: 'tabs', id: `t-${id}`, panelIds: [`p-${id}`], activeIndex: 0 },
  }
}

function shape(id: string, x: number, y: number, w = 100, h = 80, kind: 'rect' | 'ellipse' = 'rect', creationIndex = 0): CanvasShapeState {
  return { id, kind, origin: { x, y }, size: { width: w, height: h }, color: '#4a9eff', creationIndex }
}

describe('anchorPoint', () => {
  it('anchors on the rect edge toward the target', () => {
    // 100x100 rect at origin, target due east → anchor at right edge midpoint.
    const p = anchorPoint(rectGeom(0, 0, 100, 100), { x: 500, y: 50 })
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(50)
  })

  it('anchors on the ellipse boundary toward the target', () => {
    // 200x100 ellipse centered at (100,50); 45° direction hits (x/100)²+(y/50)²=1.
    const p = anchorPoint(rectGeom(0, 0, 200, 100, true), { x: 200, y: 100 })
    const nx = (p.x - 100) / 100
    const ny = (p.y - 50) / 50
    expect(nx * nx + ny * ny).toBeCloseTo(1)
  })

  it('degenerates to the center when the target IS the center', () => {
    const p = anchorPoint(rectGeom(0, 0, 100, 100), { x: 50, y: 50 })
    expect(p).toEqual({ x: 50, y: 50 })
  })
})

describe('connectorLine', () => {
  const nodes = { a: node('a', 0, 0), b: node('b', 400, 0) }

  it('anchors both ends on the facing edges', () => {
    const line = connectorLine({ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'b' }, nodes, {})!
    expect(line.from.x).toBeCloseTo(100) // right edge of a
    expect(line.to.x).toBeCloseTo(400) // left edge of b
    expect(line.from.y).toBeCloseTo(40)
    expect(line.to.y).toBeCloseTo(40)
  })

  it('returns null when an endpoint is gone', () => {
    expect(connectorLine({ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'ghost' }, nodes, {})).toBeNull()
  })

  it('returns null for heavily overlapping targets (anchors cross)', () => {
    const overlapping = { a: node('a', 0, 0), b: node('b', 10, 10) }
    expect(connectorLine({ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'b' }, overlapping, {})).toBeNull()
  })
})

describe('hit testing', () => {
  it('ellipse hit excludes the bounding-rect corners', () => {
    const shapes = { e: shape('e', 0, 0, 100, 100, 'ellipse') }
    expect(hitTestShape(shapes, { x: 50, y: 50 })?.id).toBe('e')
    expect(hitTestShape(shapes, { x: 2, y: 2 })).toBeNull() // corner outside the ellipse
  })

  it('later shape wins where shapes overlap', () => {
    const shapes = { s1: shape('s1', 0, 0, 100, 100, 'rect', 0), s2: shape('s2', 50, 50, 100, 100, 'rect', 1) }
    expect(hitTestShape(shapes, { x: 75, y: 75 })?.id).toBe('s2')
  })

  it('a node covering a shape wins the endpoint (nodes render on top)', () => {
    const nodes = { n: node('n', 0, 0) }
    const shapes = { s: shape('s', 0, 0, 300, 300) }
    expect(hitTestEndpoint(nodes, shapes, { x: 50, y: 40 })).toEqual({ kind: 'node', nodeId: 'n' })
    expect(hitTestEndpoint(nodes, shapes, { x: 250, y: 250 })).toEqual({ kind: 'shape', shapeId: 's' })
    expect(hitTestEndpoint(nodes, shapes, { x: 900, y: 900 })).toBeNull()
  })
})
