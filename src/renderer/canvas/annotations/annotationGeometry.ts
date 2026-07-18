// =============================================================================
// Annotation geometry — pure math for connectors (endpoint resolution + edge
// anchoring) and shape hit-testing. No store or DOM access, unit-testable.
// =============================================================================

import type {
  CanvasConnectorEndpoint,
  CanvasNodeState,
  CanvasShapeState,
  Point,
  Rect,
  Size,
} from '../../../shared/types'

interface EndpointGeom {
  rect: Rect
  /** How the boundary anchor is computed: ellipse endpoints anchor on the
   *  ellipse itself, everything else on the rect border. */
  ellipse: boolean
}

/** Resolve a connector endpoint to its current rect (null when the target is
 *  gone — the connector should not render). */
export function resolveEndpoint(
  ep: CanvasConnectorEndpoint,
  nodes: Record<string, CanvasNodeState>,
  shapes: Record<string, CanvasShapeState>,
): EndpointGeom | null {
  if (ep.kind === 'node') {
    const n = nodes[ep.nodeId]
    return n ? { rect: { origin: n.origin, size: n.size }, ellipse: false } : null
  }
  const s = shapes[ep.shapeId]
  return s ? { rect: { origin: s.origin, size: s.size }, ellipse: s.kind === 'ellipse' } : null
}

export function rectCenter(rect: Rect): Point {
  return {
    x: rect.origin.x + rect.size.width / 2,
    y: rect.origin.y + rect.size.height / 2,
  }
}

/** Point where the segment from the rect's center toward `toward` crosses the
 *  rect boundary (or the inscribed ellipse's boundary). Falls back to the
 *  center for a degenerate direction. */
export function anchorPoint(geom: EndpointGeom, toward: Point): Point {
  const c = rectCenter(geom.rect)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = geom.rect.size.width / 2
  const hh = geom.rect.size.height / 2
  if (geom.ellipse) {
    // Ellipse boundary along direction (dx, dy): scale so (x/hw)² + (y/hh)² = 1.
    const t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
    return { x: c.x + dx * t, y: c.y + dy * t }
  }
  // Rect boundary: smallest positive scale that reaches a side.
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

export interface ConnectorLine {
  from: Point
  to: Point
}

/** The rendered segment for a connector: each end anchored on its target's
 *  boundary, aimed at the other target's center. Null when either endpoint is
 *  gone or the targets overlap so much the segment degenerates. */
export function connectorLine(
  from: CanvasConnectorEndpoint,
  to: CanvasConnectorEndpoint,
  nodes: Record<string, CanvasNodeState>,
  shapes: Record<string, CanvasShapeState>,
): ConnectorLine | null {
  const a = resolveEndpoint(from, nodes, shapes)
  const b = resolveEndpoint(to, nodes, shapes)
  if (!a || !b) return null
  const ca = rectCenter(a.rect)
  const cb = rectCenter(b.rect)
  const p1 = anchorPoint(a, cb)
  const p2 = anchorPoint(b, ca)
  // Overlapping targets: anchors cross over and the arrow points backwards.
  const dot = (p2.x - p1.x) * (cb.x - ca.x) + (p2.y - p1.y) * (cb.y - ca.y)
  if (dot <= 0) return null
  return { from: p1, to: p2 }
}

/** Arrowhead polygon points (SVG `points` string) for a segment end. Sized in
 *  canvas units; callers scale by 1/zoom for a constant screen size. */
export function arrowheadPoints(from: Point, to: Point, size: number): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const spread = Math.PI / 7
  const p1 = { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) }
  const p2 = { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) }
  return `${to.x},${to.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`
}

export function pointInRect(p: Point, origin: Point, size: Size): boolean {
  return p.x >= origin.x && p.x <= origin.x + size.width && p.y >= origin.y && p.y <= origin.y + size.height
}

function pointInShape(p: Point, s: CanvasShapeState): boolean {
  if (!pointInRect(p, s.origin, s.size)) return false
  if (s.kind === 'rect') return true
  const c = rectCenter({ origin: s.origin, size: s.size })
  const hw = s.size.width / 2
  const hh = s.size.height / 2
  const nx = (p.x - c.x) / hw
  const ny = (p.y - c.y) / hh
  return nx * nx + ny * ny <= 1
}

/** Topmost shape under a canvas-space point (later creationIndex wins). */
export function hitTestShape(shapes: Record<string, CanvasShapeState>, p: Point): CanvasShapeState | null {
  let best: CanvasShapeState | null = null
  for (const s of Object.values(shapes)) {
    if (pointInShape(p, s) && (!best || s.creationIndex > best.creationIndex)) best = s
  }
  return best
}

/** Topmost node under a canvas-space point (highest zOrder wins). */
export function hitTestNode(nodes: Record<string, CanvasNodeState>, p: Point): CanvasNodeState | null {
  let best: CanvasNodeState | null = null
  for (const n of Object.values(nodes)) {
    if (pointInRect(p, n.origin, n.size) && (!best || n.zOrder > best.zOrder)) best = n
  }
  return best
}

export interface ShapeMembers {
  nodeIds: string[]
  shapeIds: string[]
}

/** Everything spatially INSIDE a shape — the members that move with it when it
 *  is dragged (frame semantics). Membership is purely geometric, evaluated at
 *  gesture start: a panel node or smaller shape belongs when its center sits
 *  inside the container's visible outline (the ellipse itself for ellipses).
 *  Nesting needs no recursion: if B is inside A, B's members' centers are
 *  inside A too. */
export function shapeMembers(
  container: CanvasShapeState,
  nodes: Record<string, CanvasNodeState>,
  shapes: Record<string, CanvasShapeState>,
): ShapeMembers {
  const area = container.size.width * container.size.height
  const nodeIds: string[] = []
  const shapeIds: string[] = []
  for (const n of Object.values(nodes)) {
    if (pointInShape(rectCenter({ origin: n.origin, size: n.size }), container)) nodeIds.push(n.id)
  }
  for (const s of Object.values(shapes)) {
    if (s.id === container.id) continue
    // Strictly smaller only — two same-size overlapping shapes must not
    // capture each other.
    if (s.size.width * s.size.height >= area) continue
    if (pointInShape(rectCenter({ origin: s.origin, size: s.size }), container)) shapeIds.push(s.id)
  }
  return { nodeIds, shapeIds }
}

/** The endpoint (shape preferred over node when both hit — shapes render under
 *  nodes but are the more deliberate annotation target only when NOT covered;
 *  nodes win where they overlap since they're visually on top). */
export function hitTestEndpoint(
  nodes: Record<string, CanvasNodeState>,
  shapes: Record<string, CanvasShapeState>,
  p: Point,
): CanvasConnectorEndpoint | null {
  const node = hitTestNode(nodes, p)
  if (node) return { kind: 'node', nodeId: node.id }
  const shape = hitTestShape(shapes, p)
  if (shape) return { kind: 'shape', shapeId: shape.id }
  return null
}
