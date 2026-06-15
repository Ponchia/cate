// =============================================================================
// CateAgentFeedback — the Cate Agent's unified panel, docked above the toolbar.
//
// The single surface for the Cate Agent: the latest conversation turn (feed
// lines) plus every actionable todo — proposals (Approve & run / Dismiss),
// running tasks (jump to terminal), the review/land gate (Merge / PR / Discard),
// and failures (Rerun). Floats directly above the toolbar pill (absolute,
// left-0 right-0) so it matches the pill's width. Shown only while the panel is
// open (the toolbar button toggles it); unseen activity is signalled on the
// button instead of auto-opening this panel.
// =============================================================================

import React from 'react'
import {
  Play,
  Sparkle,
  X,
  GitMerge,
  GitPullRequest,
  Trash,
  ArrowSquareOut,
  CircleNotch,
} from '@phosphor-icons/react'
import { useTodosStore } from '../stores/todosStore'
import { useCateAgentWs } from './cateAgentStore'
import { cateAgentController } from './cateAgentController'
import { mergeTodo, openPrTodo, discardTodo } from './cateAgentReviewActions'
import { revealPanel } from '../lib/workspace/panelReveal'
import type { CateAgentFeedKind } from './cateAgentStore'
import type { Todo } from '../../shared/types'

const KIND_CLASS: Record<CateAgentFeedKind, string> = {
  user: 'text-primary',
  agent: 'text-secondary',
  status: 'text-muted',
  error: 'text-red-400',
}

// Actionable statuses, in the order they should appear in the panel. `done` and
// `discarded` are history and intentionally omitted from this transient surface.
const SHOWN_STATUSES: Todo['status'][] = ['review', 'suggested', 'in_progress', 'pending', 'failed']

export const CateAgentFeedback: React.FC<{ workspaceId: string; rootPath: string }> = ({ workspaceId, rootPath }) => {
  const wsId = workspaceId
  const cateAgent = useCateAgentWs(wsId)
  const todos = useTodosStore((s) => s.todosByRoot[rootPath])
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Show only the latest turn: the most recent user message and everything the
  // Cate Agent said in response to it, so the panel stays compact.
  const feed = cateAgent.feed
  const lastUserIdx = feed.map((f) => f.kind).lastIndexOf('user')
  const visibleFeed = lastUserIdx >= 0 ? feed.slice(lastUserIdx) : feed

  const shown = (todos ?? []).filter((t) => SHOWN_STATUSES.includes(t.status))
  const orderedTodos = [...shown].sort(
    (a, b) => SHOWN_STATUSES.indexOf(a.status) - SHOWN_STATUSES.indexOf(b.status),
  )
  const hasContent = visibleFeed.length > 0 || orderedTodos.length > 0

  // Keep the newest content in view as items arrive.
  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleFeed.length, orderedTodos.length])

  // Opened by the toolbar button; never auto-opens on new activity.
  if (!wsId || !cateAgent.inputOpen || !hasContent) return null

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-subtle bg-surface-0 shadow-[0_8px_24px_-6px_var(--shadow-node)] overflow-hidden">
      <div ref={scrollRef} className="max-h-[50vh] overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        {visibleFeed.map((item) => (
          <div key={item.id} className={`text-[12px] leading-snug break-words ${KIND_CLASS[item.kind]}`}>
            {item.kind === 'user' ? <span className="text-muted">You: </span> : null}
            {item.text}
          </div>
        ))}

        {orderedTodos.map((t) => (
          <TodoCard key={t.id} todo={t} wsId={wsId} rootPath={rootPath} />
        ))}
      </div>
    </div>
  )
}

// One todo rendered with the actions appropriate to its status. Self-contained so
// the panel can render any actionable status uniformly.
const TodoCard: React.FC<{ todo: Todo; wsId: string; rootPath: string }> = ({ todo, wsId, rootPath }) => {
  const removeTodo = useTodosStore((s) => s.removeTodo)
  const [busy, setBusy] = React.useState(false)

  const runReview = async (fn: (w: string, r: string, t: Todo) => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn(wsId, rootPath, todo)
    } finally {
      setBusy(false)
    }
  }

  const terminalId = todo.terminalNodeIds?.[todo.terminalNodeIds.length - 1]
  const btn = 'flex items-center gap-1 px-2 py-0.5 rounded text-[11.5px] transition-colors disabled:opacity-40'

  const actions = (() => {
    switch (todo.status) {
      case 'suggested':
        return (
          <>
            <button onClick={() => void cateAgentController.runTodo(wsId, rootPath, todo.id)} className={`${btn} text-white bg-blue-500 hover:bg-blue-600`}>
              <Play size={10} weight="fill" /> Approve &amp; run
            </button>
            <button onClick={() => removeTodo(rootPath, todo.id)} className={`${btn} text-muted hover:text-primary hover:bg-hover`}>
              <X size={10} /> Dismiss
            </button>
          </>
        )
      case 'in_progress':
        return terminalId ? (
          <button onClick={() => void revealPanel(wsId, terminalId, { retry: true })} className={`${btn} text-muted hover:text-primary hover:bg-hover`}>
            <ArrowSquareOut size={11} /> Jump to terminal
          </button>
        ) : null
      case 'review':
        return (
          <>
            <button disabled={busy} onClick={() => void runReview(mergeTodo)} className={`${btn} text-white bg-green-600 hover:bg-green-700`}>
              <GitMerge size={11} /> Merge
            </button>
            <button disabled={busy} onClick={() => void runReview(openPrTodo)} className={`${btn} text-secondary hover:text-primary hover:bg-hover`}>
              <GitPullRequest size={11} /> PR
            </button>
            <button disabled={busy} onClick={() => void runReview(discardTodo)} className={`${btn} text-muted hover:text-red-400 hover:bg-hover`}>
              <Trash size={11} /> Discard
            </button>
          </>
        )
      case 'pending':
        return (
          <>
            <button onClick={() => void cateAgentController.runTodo(wsId, rootPath, todo.id)} className={`${btn} text-secondary hover:text-blue-400 hover:bg-hover`}>
              <Play size={11} /> Run
            </button>
            <button onClick={() => removeTodo(rootPath, todo.id)} className={`${btn} text-muted hover:text-red-400 hover:bg-hover`}>
              <X size={11} /> Delete
            </button>
          </>
        )
      default: // failed
        return (
          <>
            <button onClick={() => void cateAgentController.runTodo(wsId, rootPath, todo.id)} className={`${btn} text-secondary hover:text-blue-400 hover:bg-hover`}>
              <Play size={11} /> Rerun
            </button>
            <button onClick={() => removeTodo(rootPath, todo.id)} className={`${btn} text-muted hover:text-red-400 hover:bg-hover`}>
              <Trash size={11} /> Remove
            </button>
          </>
        )
    }
  })()

  const glyph =
    todo.status === 'in_progress' ? (
      <CircleNotch size={13} className="mt-[2px] flex-shrink-0 text-green-400 animate-spin" />
    ) : todo.status === 'review' ? (
      <GitMerge size={13} className="mt-[2px] flex-shrink-0 text-amber-400" />
    ) : todo.status === 'failed' ? (
      <X size={13} className="mt-[2px] flex-shrink-0 text-red-400/70" />
    ) : (
      <Sparkle size={13} weight="fill" className="mt-[2px] flex-shrink-0 text-blue-400" />
    )

  return (
    <div className="rounded-lg border border-subtle bg-surface-1 px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-start gap-1.5">
        {glyph}
        <span className="flex-1 min-w-0 text-[12.5px] leading-snug text-primary break-words">{todo.title}</span>
      </div>
      {todo.branch && <div className="text-[11px] text-muted truncate font-mono">{todo.branch}</div>}
      {todo.note && (
        <div className={`text-[11.5px] leading-snug break-words ${todo.status === 'review' ? 'text-amber-400/90' : 'text-muted'}`}>
          {todo.note}
        </div>
      )}
      {actions && <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{actions}</div>}
    </div>
  )
}
