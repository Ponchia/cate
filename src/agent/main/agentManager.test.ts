// Coverage for AgentManager.disposeForWebContents — the hook that drops every
// pi session owned by a window whose webContents went away (wired from
// ipcAgent's AGENT_CREATE 'destroyed' listener). Sessions are injected straight
// into the private map and dispose() is spied, so this exercises the
// sender-id filtering without spawning pi.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../main/windowRegistry', () => ({ broadcastToAll: vi.fn() }))
vi.mock('../../main/runtime/runtimeManager', () => ({ runtimes: { resolve: vi.fn() } }))
vi.mock('../../main/runtime/locator', () => ({
  parseLocator: vi.fn(() => ({ runtimeId: 'local', path: '/ws' })),
}))
vi.mock('./piRpcClient', () => ({ PiRpcClient: vi.fn() }))
vi.mock('./installSubagents', () => ({ installSubagentExtension: vi.fn() }))
vi.mock('./installPlanMode', () => ({ installPlanModeExtension: vi.fn() }))
vi.mock('./installAskUser', () => ({ installAskUserExtension: vi.fn() }))
vi.mock('./agentDir', () => ({
  hostAgentDir: vi.fn(() => '/agent'),
  prepareAgentDir: vi.fn(),
  watchWorkspaceAuth: vi.fn(),
  pushSharedToWorkspace: vi.fn(),
}))
vi.mock('./customModels', () => ({ mirrorModelsToWorkspace: vi.fn() }))

import { AgentManager } from './agentManager'
import type { AuthManager } from './authManager'

const fakeAuthManager = { setOnChange: vi.fn() } as unknown as AuthManager

function makeManager() {
  const mgr = new AgentManager(fakeAuthManager)
  const disposed: string[] = []
  // dispose() runs through withLock + disposeInternal; stub it so we assert
  // exactly which panels were targeted without touching real pi clients.
  vi.spyOn(mgr, 'dispose').mockImplementation(async (panelId: string) => {
    disposed.push(panelId)
  })
  // Inject sessions with only the fields disposeForWebContents reads.
  const sessions = (mgr as unknown as { sessions: Map<string, { sender: { id: number } }> }).sessions
  const inject = (panelId: string, senderId: number) =>
    sessions.set(panelId, { sender: { id: senderId } })
  return { mgr, disposed, inject }
}

describe('AgentManager.disposeForWebContents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('disposes only sessions owned by the destroyed webContents', () => {
    const { mgr, disposed, inject } = makeManager()
    inject('a', 1)
    inject('b', 1)
    inject('c', 2)

    mgr.disposeForWebContents(1)

    expect(disposed.sort()).toEqual(['a', 'b'])
  })

  it('is a no-op when no session matches the webContents id', () => {
    const { mgr, disposed, inject } = makeManager()
    inject('a', 1)

    mgr.disposeForWebContents(99)

    expect(disposed).toEqual([])
  })

  it('leaves other windows sessions intact', () => {
    const { mgr, disposed, inject } = makeManager()
    inject('a', 1)
    inject('b', 2)
    inject('c', 2)

    mgr.disposeForWebContents(2)

    expect(disposed.sort()).toEqual(['b', 'c'])
  })
})

// runTurn is the non-streaming extension turn runner: it resolves with the final
// assistant message read straight off the terminal `agent_end` event's `messages`.
// The tricky case is pi's auto-retry: it emits an `agent_end` with willRetry:true
// for the failed turn (whose last assistant message is an empty error) before the
// real terminal one. Resolving on the first agent_end is what produced "(no text)".
describe('AgentManager.runTurn', () => {
  beforeEach(() => vi.clearAllMocks())

  function fakeClient() {
    let eventListener: ((ev: unknown) => void) | undefined
    return {
      emit: (ev: unknown) => eventListener?.(ev),
      onEvent: (l: (ev: unknown) => void) => { eventListener = l; return () => {} },
      onExit: () => () => {},
      prompt: vi.fn(async () => {}),
    }
  }

  const run = (client: unknown) =>
    (new AgentManager(fakeAuthManager) as unknown as {
      runTurn(s: unknown, t: string): Promise<{ text: string; message: unknown }>
    }).runTurn({ client }, 'hi')

  const assistant = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })
  const toolOnly = { role: 'assistant', content: [{ type: 'toolCall', name: 'x' }] }

  it('skips a willRetry agent_end and resolves on the terminal one', async () => {
    const client = fakeClient()
    const result = run(client)

    // Failed turn: pi will retry, so this carries the empty error message.
    client.emit({ type: 'agent_end', willRetry: true, messages: [assistant('')] })
    // Retry succeeds.
    const answer = assistant('the answer')
    client.emit({ type: 'agent_end', willRetry: false, messages: [answer] })

    expect(await result).toEqual({ text: 'the answer', message: answer })
  })

  it('returns the answer-bearing assistant message, scanning past a tool-only turn', async () => {
    const client = fakeClient()
    const result = run(client)

    // Final turn is a tool call with no text — text and message both come from
    // the real answer turn so they agree.
    const answer = assistant('real answer')
    client.emit({ type: 'agent_end', messages: [answer, toolOnly] })

    expect(await result).toEqual({ text: 'real answer', message: answer })
  })

  it('returns empty text but still the raw message when no turn carries text', async () => {
    const client = fakeClient()
    const result = run(client)

    client.emit({ type: 'agent_end', messages: [toolOnly] })

    expect(await result).toEqual({ text: '', message: toolOnly })
  })

  it('rejects with the reason when the turn ends on stopReason error', async () => {
    const client = fakeClient()
    const result = run(client)

    // pi surfaces an unsupported-model/auth failure as an empty assistant message
    // with stopReason 'error' — must reject, not resolve to silent empty text.
    client.emit({
      type: 'agent_end',
      willRetry: false,
      messages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'model not supported' }],
    })

    await expect(result).rejects.toThrow('model not supported')
  })
})
