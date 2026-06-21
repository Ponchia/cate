// =============================================================================
// NodeErrorBoundary
//
// Isolates a render error in a single canvas node's chrome (CanvasNode) so one
// broken node fails in place instead of tearing down the whole window via the
// top-level boundary in main.tsx. A node that throws can't be positioned (its
// geometry is exactly what's usually broken), so the fallback renders nothing —
// the node simply disappears — while the error is logged and reported to Sentry.
//
// Panel *content* errors are caught closer to the panel by PanelErrorBoundary;
// this covers the node frame around them.
// =============================================================================

import React from 'react'
import log from '../lib/logger'
import { captureRendererException } from '../lib/sentry'

interface Props {
  children?: React.ReactNode
  /** Node id — surfaced in the Sentry context and used to auto-reset when the
   *  slot is reused for a different node. */
  nodeId?: string
}

interface State {
  error: Error | null
}

export class NodeErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.nodeId !== this.props.nodeId) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error(
      'Canvas node render error (id=%s): %s\n%s',
      this.props.nodeId ?? 'unknown',
      error.message,
      info.componentStack,
    )
    captureRendererException(error, {
      nodeId: this.props.nodeId,
      componentStack: info.componentStack,
      source: 'NodeErrorBoundary',
    })
  }

  render(): React.ReactNode {
    if (this.state.error) return null
    return this.props.children
  }
}
