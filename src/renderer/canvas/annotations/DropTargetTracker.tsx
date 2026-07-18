// =============================================================================
// DropTargetTracker — while a panel node (or dock tab) is being dragged,
// highlight the container shape under the cursor so it's obvious the panel
// will land "inside" it (frame membership is geometric, so dropping inside is
// all it takes). Purely imperative: subscribes to the drag store and writes
// the canvas store's transient dropTargetShapeId — no React re-renders here.
// =============================================================================

import React, { useEffect } from 'react'
import { useDragStore } from '../../drag'
import { useCanvasStoreApi } from '../../stores/CanvasStoreContext'
import { viewToCanvas } from '../../lib/canvas/coordinates'
import { hitTestShape } from './annotationGeometry'

const DropTargetTracker: React.FC<{ canvasRef: React.RefObject<HTMLDivElement | null> }> = ({ canvasRef }) => {
  const canvasApi = useCanvasStoreApi()

  useEffect(() => {
    const unsubscribe = useDragStore.subscribe((s) => {
      const state = canvasApi.getState()
      const clear = () => { if (state.dropTargetShapeId) state.setDropTargetShape(null) }
      if (!s.isDragging || !s.cursor || !s.panel) { clear(); return }
      // Only container shapes matter, and only when this canvas has any.
      const el = canvasRef.current
      if (!el) { clear(); return }
      const rect = el.getBoundingClientRect()
      const { client } = s.cursor
      if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) {
        clear()
        return
      }
      const pt = viewToCanvas(
        { x: client.x - rect.left, y: client.y - rect.top },
        state.zoomLevel,
        state.viewportOffset,
      )
      const hit = hitTestShape(state.shapes, pt)
      state.setDropTargetShape(hit && hit.kind !== 'note' ? hit.id : null)
    })
    return () => {
      unsubscribe()
      canvasApi.getState().setDropTargetShape(null)
    }
  }, [canvasApi, canvasRef])

  return null
}

export default DropTargetTracker
