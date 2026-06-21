// =============================================================================
// Ambient typings for the `cate` global injected into extension webview guests
// by src/preload/cateHost.ts. Mirrors the reverse-API surface in
// docs/extensions.md. Methods not yet supported in Phase 1 still exist and
// resolve/reject with a clear "unsupported" result so feature detection via
// `cate.version` works.
// =============================================================================

/** Theme tokens handed to a guest by `cate.theme.get()`. */
export interface CateHostTheme {
  id: string
  type: 'dark' | 'light'
  /** Merged app CSS-var palette (key without leading `--`). */
  app: Record<string, string>
  /** Terminal ANSI palette. */
  terminal: Record<string, string>
}

/** Result of one agent turn (`cate.agent.send` / `cate.agent.run`): the flattened
 *  `text` for convenience plus the raw final assistant `message` from pi (its role
 *  and content blocks — text, tool calls, etc.), or null if the turn produced none. */
export interface AgentTurnResult {
  text: string
  message: Record<string, unknown> | null
}

/** Workspace context handed to a guest by `cate.workspace.get()`. */
export interface CateHostWorkspace {
  rootPath: string | null
  branch: string | null
  worktree: string | null
}

export interface CateHostStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  panel: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  /** Subscribe to storage changes (external edits or writes from other panels).
   *  Returns an unsubscribe function. */
  onChange(cb: (key?: string) => void): () => void
}

export interface CatePanel {
  /** This panel instance's id. */
  readonly id: string
  setTitle(title: string): Promise<void>
}

export interface CateHost {
  /** API version int, for feature detection. */
  version(): Promise<number>
  panel: CatePanel
  workspace: {
    get(): Promise<CateHostWorkspace>
  }
  theme: {
    get(): Promise<CateHostTheme>
  }
  editor: {
    openFile(path: string, opts?: { line?: number; column?: number }): Promise<unknown>
  }
  canvas: {
    createPanel(
      type: string,
      opts?: { position?: unknown; size?: unknown; props?: unknown },
    ): Promise<unknown>
  }
  ui: {
    notify(message: string, level?: 'info' | 'warn' | 'error'): Promise<unknown>
  }
  /** Drive Cate's bundled agent (requires the `agent` scope + first-use user
   *  consent). pi owns all conversation state on its session file; the handle
   *  returned by `open` is that file's path, so a conversation can be resumed
   *  later with nothing persisted on Cate's side. Turn-based: each `send`/`run`
   *  resolves on the agent's terminal `agent_end` (a turn can take minutes). One
   *  live session per extension; one turn in flight per session. */
  agent: {
    /** Open (or `resume` a previous) session; returns its handle. */
    open(opts?: { resume?: string }): Promise<{ sessionId: string } | { error: string }>
    /** Run one turn on an open session; returns the final assistant message. */
    send(sessionId: string, prompt: string): Promise<AgentTurnResult | { error: string }>
    /** Tear down the live session (pi's jsonl stays; reopen via `resume`). */
    dispose(sessionId: string): Promise<unknown>
    /** One-shot sugar over open -> send -> dispose. */
    run(prompt: string): Promise<AgentTurnResult | { error: string }>
    /** Abort the in-flight turn of this extension's session. */
    cancel(): Promise<unknown>
  }
  storage: CateHostStorage
}

declare global {
  interface Window {
    cate: CateHost
  }
}
