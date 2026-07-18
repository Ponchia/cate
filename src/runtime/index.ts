// =============================================================================
// cate-runtime daemon entry. Runs as a standalone Node program — locally as a
// child process, on a server over SSH exec, or inside WSL — and speaks the
// LF-JSON runtime protocol over stdio. stdin carries `req` frames; stdout
// carries `hello` / `res` / `evt` frames. Nothing electron is imported here, so
// this bundles into a runtime-agnostic file (see build/esbuild.config.mjs).
//
// Usage: cate-runtime --root <abs-path> --id <runtimeId> [--exclude a,b,c]
//        cate-runtime --root <abs-path> --id <runtimeId> --listen <host:port> \
//          [--token-file <path>]   # persistent multi-client mode (tmux-style)
// =============================================================================

import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomBytes } from 'crypto'
import { addAllowedRoot } from '../main/ipc/pathValidation'
import { RpcServer } from './rpcServer'
import { buildDaemonRuntime } from './capabilities'
import { hostExtensionsRoot } from './capabilities/extensions'
import { reapOrphanServers } from './capabilities/server'
import { applyLoginEnv } from './loginEnv'
import { startWsServer } from './wsServer'

interface DaemonArgs {
  root: string
  id: string
  exclusions: string[]
  idleSuspend: boolean
  /** host:port to serve WebSocket clients on (persistent mode). Empty → stdio. */
  listen: string
  /** Token file for --listen auth. Created (0600, random) if absent. */
  tokenFile: string
  /** Built web-client directory to serve over HTTP on the same port. */
  webRoot: string
}

function parseArgs(argv: string[]): DaemonArgs {
  let root = ''
  let id = 'remote'
  let exclusions: string[] = []
  let idleSuspend = false
  let listen = ''
  let tokenFile = ''
  let webRoot = ''
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') root = argv[++i] ?? ''
    else if (a === '--id') id = argv[++i] ?? id
    else if (a === '--exclude') exclusions = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--idle-suspend') idleSuspend = true
    else if (a === '--listen') listen = argv[++i] ?? ''
    else if (a === '--token-file') tokenFile = argv[++i] ?? ''
    else if (a === '--web-root') webRoot = argv[++i] ?? ''
  }
  if (!root) {
    process.stderr.write('cate-runtime: --root <abs-path> is required\n')
    process.exit(2)
  }
  return { root, id, exclusions, idleSuspend, listen, tokenFile, webRoot }
}

/** Read the auth token for --listen mode, generating one (0600) on first run
 *  so a fresh install has a secret without any manual step. */
function loadOrCreateToken(tokenFile: string): string {
  const file = tokenFile || path.join(os.homedir(), '.cate', 'runtime-token')
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim()
    if (existing) return existing
  } catch { /* absent → create below */ }
  const token = randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, token + '\n', { mode: 0o600 })
  process.stderr.write(`cate-runtime: generated auth token at ${file}\n`)
  return token
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // Merge the user's login-shell env over process.env (skipped when the
  // launcher already resolved it — see loginEnv.ts). Awaited so the very first
  // spawn sees the same PATH a local daemon gets from getShellEnv().
  await applyLoginEnv()

  // The daemon's filesystem sandbox: its workspace root (plus the system temp
  // dir, which pathValidation always allows). Everything the client asks for is
  // validated against this on the daemon side — the authoritative check, since
  // only the daemon can realpath its own filesystem.
  addAllowedRoot(args.root, args.id)

  // The per-host extensions install root (~/.cate/extensions) is also allowed,
  // independent of the workspace root: extensions are installed once per host and
  // shared across that host's workspaces. Registered here so static serving and
  // server-cwd validation succeed after a daemon restart even before any
  // re-provision call runs.
  addAllowedRoot(hostExtensionsRoot(), args.id)

  // Reap any extension-server children a PREVIOUS run of this daemon (same --id)
  // left orphaned — e.g. after a hard crash that skipped killAll(). Best-effort
  // SIGKILL of the recorded pids, then clears the pid file. Runs BEFORE serving so
  // a restart never accumulates leaked servers. (createServerCapability records
  // pids under the same daemonId, so this and the live capability agree.)
  reapOrphanServers(args.id)

  const { runtime, process: proc, killAll } = buildDaemonRuntime({
    id: args.id,
    exclusions: args.exclusions,
    idleSuspend: args.idleSuspend,
  })

  // Reap every live pty's process group + every server child / tunnel socket.
  // Runs on daemon termination in BOTH modes: for stdio that's the client
  // quitting (kill children with it — the classic behavior); for --listen
  // that's an explicit service stop (tmux kill-server semantics). A client
  // merely DISCONNECTING in --listen mode never reaches this path.
  let cleanup: () => void = () => {}
  const shutdown = (): void => {
    proc.killAllGroups()
    killAll()
    cleanup()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  if (args.listen) {
    // Persistent multi-client mode: sessions outlive connections. Parse
    // host:port (IPv6 hosts use [addr]:port).
    const m = args.listen.match(/^\[?([^\]]*)\]?:(\d+)$/)
    if (!m) {
      process.stderr.write(`cate-runtime: invalid --listen "${args.listen}" (expected host:port)\n`)
      process.exit(2)
    }
    const token = loadOrCreateToken(args.tokenFile)
    const handle = startWsServer({
      host: m[1],
      port: parseInt(m[2], 10),
      token,
      api: runtime,
      webRoot: args.webRoot || undefined,
    })
    cleanup = () => handle.close()
    return
  }

  // Connection-scoped stdio mode: one client, die (and reap children) with it.
  const server = new RpcServer(runtime, (line) => process.stdout.write(line))
  cleanup = () => server.dispose()
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk) => server.handleChunk(chunk))
  process.stdin.on('close', shutdown)

  server.start()
}

void main()
