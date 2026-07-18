// Live integration: the FULL persistent-session client stack against a real
// `cate-runtime --listen` daemon — RuntimeManager + WsRuntimeTransport +
// RemoteRuntime.sessions, in real processes over a real socket.
//
// Verifies the tmux contract end to end from the client's side:
//   1. connect over ws:// with token auth (bad token rejected)
//   2. create a pty, see output
//   3. DROP the connection — the daemon keeps the session
//   4. reconnect (fresh transport, same manager id), list + attach with a byte
//      cursor, and receive exactly the missed output as replay
//   5. two managers attached at once both receive live fan-out
//
// Requires the runtime bundle: `npm run build:runtime` (dist-runtime/runtime.cjs).
// Run via `bunx vitest run -c vitest.live.config.ts src/main/runtime/wsPersist.itest.ts`.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { RuntimeManager } from './runtimeManager'
import { WsRuntimeTransport } from './transports/wsTransport'

const BUNDLE = path.resolve(process.cwd(), 'dist-runtime/runtime.cjs')
const PORT = 7871
const TOKEN = 'itest-token-0123456789abcdef0123456789abcdef'

describe.skipIf(!existsSync(BUNDLE))('persistent daemon over ws (live)', () => {
  let daemon: ChildProcess
  let workspace: string
  let tokenFile: string

  beforeAll(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cate-ws-itest-')))
    tokenFile = path.join(workspace, 'token')
    await fs.writeFile(tokenFile, TOKEN + '\n', { mode: 0o600 })
    daemon = spawn(process.execPath, [
      BUNDLE,
      '--root', workspace,
      '--id', 'itest-persist',
      '--listen', `127.0.0.1:${PORT}`,
      '--token-file', tokenFile,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    // Wait for the listener line on stderr.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon did not start listening')), 10_000)
      daemon.stderr!.on('data', (d: Buffer) => {
        if (d.toString().includes('[ws] listening')) { clearTimeout(timer); resolve() }
      })
      daemon.on('exit', (code) => reject(new Error(`daemon exited early (${code})`)))
    })
  })

  afterAll(async () => {
    daemon?.kill('SIGTERM')
    await fs.rm(workspace, { recursive: true, force: true })
  })

  test('bad token is rejected before the handshake', async () => {
    const mgr = new RuntimeManager()
    const transport = new WsRuntimeTransport(`ws://127.0.0.1:${PORT}/?token=wrong`)
    await expect(mgr.connect('srv_bad', transport)).rejects.toThrow()
    await mgr.disposeAll()
  })

  test('sessions survive a dropped client and replay missed output on reattach', async () => {
    const url = `ws://127.0.0.1:${PORT}/?token=${TOKEN}`

    // --- client 1: connect, spawn a shell, see a marker ---
    const mgr1 = new RuntimeManager()
    const rt1 = await mgr1.connect('srv_ws', new WsRuntimeTransport(url))
    let out1 = ''
    let ptyId = ''
    const sawMarker = new Promise<void>((resolve) => {
      void rt1.process.create(
        { cols: 80, rows: 24, cwd: workspace, shell: '/bin/bash' },
        (_id, data) => {
          out1 += data
          if (out1.includes('MARK-A-99')) resolve()
        },
        () => {},
      ).then((handle) => {
        ptyId = handle.id
        rt1.process.write(handle.id, 'echo MARK-A-$((100-1))\n')
      })
    })
    await sawMarker
    const bytesSeen = Buffer.byteLength(out1, 'utf-8')

    // --- drop client 1 abruptly; emit more output into the void ---
    // (write BEFORE the drop so ordering is deterministic: the daemon's shell
    // prints while nobody is attached.)
    rt1.process.write(ptyId, 'echo WHILE-AWAY-$((6*7))\n')
    await new Promise((r) => setTimeout(r, 700))
    await mgr1.disposeAll()
    await new Promise((r) => setTimeout(r, 300))

    // --- client 2: fresh manager+transport; the session must still be there ---
    const mgr2 = new RuntimeManager()
    const rt2 = await mgr2.connect('srv_ws', new WsRuntimeTransport(url))
    const sessions = await rt2.sessions!.listPtys()
    expect(sessions.map((s) => s.id)).toContain(ptyId)

    let out2 = ''
    const att = await rt2.sessions!.attachPty(ptyId, (_id, d) => { out2 += d }, () => {}, bytesSeen)
    // The replay covers exactly what was missed while detached.
    expect(att.replay).toContain('WHILE-AWAY-42')
    expect(att.replay.includes('MARK-A-99')).toBe(false)

    // --- client 3 attaches concurrently; both see live fan-out ---
    const mgr3 = new RuntimeManager()
    const rt3 = await mgr3.connect('srv_ws2', new WsRuntimeTransport(url))
    let out3 = ''
    await rt3.sessions!.attachPty(ptyId, (_id, d) => { out3 += d }, () => {}, att.offset)
    rt2.process.write(ptyId, 'echo BOTH-$((21*2))\n')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fan-out did not reach both clients')), 8000)
      const check = setInterval(() => {
        if (out2.includes('BOTH-42') && out3.includes('BOTH-42')) {
          clearTimeout(timer); clearInterval(check); resolve()
        }
      }, 100)
    })

    rt2.process.kill(ptyId)
    await mgr2.disposeAll()
    await mgr3.disposeAll()
  })

  test('re-attach on the SAME connection replaces the subscription — output is never duplicated', async () => {
    // Renderer-reload shape: the client process and its socket survive, and the
    // restored terminal attaches to a pty this connection is already subscribed
    // to. The daemon must REPLACE the subscription; before the fix each stale
    // attach fanned every byte out once more ("jj" duplicated keystroke echo).
    const url = `ws://127.0.0.1:${PORT}/?token=${TOKEN}`
    const mgr = new RuntimeManager()
    const rt = await mgr.connect('srv_dup', new WsRuntimeTransport(url))

    let ptyId = ''
    let created = ''
    await new Promise<void>((resolve) => {
      void rt.process.create(
        { cols: 80, rows: 24, cwd: workspace, shell: '/bin/bash' },
        (_id, data) => {
          created += data
          if (created.includes('READY-7')) resolve()
        },
        () => {},
      ).then((handle) => {
        ptyId = handle.id
        rt.process.write(ptyId, 'echo READY-$((3+4))\n')
      })
    })

    // Attach twice more on the SAME connection with fresh callbacks (each a
    // "reloaded renderer" pipeline). Only the latest may receive output.
    const cursor = Buffer.byteLength(created, 'utf-8')
    let outA = ''
    await rt.sessions!.attachPty(ptyId, (_id, d) => { outA += d }, () => {}, cursor)
    let outB = ''
    await rt.sessions!.attachPty(ptyId, (_id, d) => { outB += d }, () => {}, cursor)

    rt.process.write(ptyId, 'echo ONCE-$((5*5))\n')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('marker never arrived')), 8000)
      const check = setInterval(() => {
        if (outB.includes('ONCE-25')) { clearTimeout(timer); clearInterval(check); resolve() }
      }, 100)
    })
    // Settle so a duplicate frame (the bug) would have landed too.
    await new Promise((r) => setTimeout(r, 500))

    const occurrences = outB.split('ONCE-25').length - 1
    expect(occurrences).toBe(1)

    rt.process.kill(ptyId)
    await mgr.disposeAll()
  })
})
