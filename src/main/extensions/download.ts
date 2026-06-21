// =============================================================================
// Extension artifact install — download + verify + extract a catalog entry's
// .tgz into a versioned dir the proxy can serve.
//
// Layout under userData:
//   extensions/<id>/<version>/         extracted extension root (manifest.json)
//   extensions/<id>/<version>/.ok      idempotency marker (written last)
//
// Mirrors the runtime tarball pattern (see runtime/runtimeArtifacts.ts):
// fetch() -> Buffer -> write a *.part temp -> rename; sha256 via crypto; extract
// by shelling out to system `tar`. Idempotent: an existing dir + .ok short-
// circuits. On any failure the partial versioned dir is removed.
// =============================================================================

import { app } from 'electron'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import log from '../logger'
import { loadManifestFromDir } from './manifest'
import { extensionsDir, type CatalogEntry } from './catalog'

const execFileAsync = promisify(execFile)

/** Extracted root dir for one (id, version). */
export function installedDir(id: string, version: string): string {
  return path.join(extensionsDir(), id, version)
}

/** True once an (id, version) is fully extracted (its .ok marker exists). */
export function isInstalled(id: string, version: string): boolean {
  return existsSync(path.join(installedDir(id, version), '.ok'))
}

/** Every fully-extracted version of an extension currently on disk. */
export async function installedVersions(id: string): Promise<string[]> {
  const dir = path.join(extensionsDir(), id)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, '.ok')))
    .map((e) => e.name)
}

/** Remove every installed version of an extension (its whole id folder). */
export async function removeInstalled(id: string): Promise<void> {
  await rm(path.join(extensionsDir(), id), { recursive: true, force: true })
}

/** Remove every installed version of an extension except `keep`. */
export async function removeInstalledVersionsExcept(id: string, keep: string): Promise<void> {
  for (const version of await installedVersions(id)) {
    if (version === keep) continue
    await rm(installedDir(id, version), { recursive: true, force: true }).catch(() => {})
  }
}

/** Fall back to '0.0.0' so an unversioned manifest still installs somewhere. */
function entryVersion(entry: CatalogEntry): string {
  return entry.manifest.version && entry.manifest.version.length > 0
    ? entry.manifest.version
    : '0.0.0'
}

function isLocal(url: string): boolean {
  if (url.startsWith('file://')) return true
  // Any string without an http(s) scheme is a local fs path — absolute, or
  // relative (with or without a leading `./`, e.g. a repo-root-relative catalog
  // artifactUrl), resolved against app.getAppPath() in localArtifactPath.
  return !/^https?:\/\//i.test(url)
}

/** Resolve a local artifact url (file://, absolute, or relative) to a fs path. */
function localArtifactPath(url: string): string {
  if (url.startsWith('file://')) return fileURLToPath(url)
  if (path.isAbsolute(url)) return url
  // Relative paths resolve against the app dir (where examples/ lives in dev).
  return path.resolve(app.getAppPath(), url)
}

/** Fetch the artifact bytes (http(s) via fetch, local via fs read). */
async function readArtifact(url: string): Promise<Buffer> {
  if (isLocal(url)) {
    return readFile(localArtifactPath(url))
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`artifact download failed: HTTP ${res.status} (${url})`)
  return Buffer.from(await res.arrayBuffer())
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Inspect a .tgz's member list BEFORE extracting and reject anything dangerous:
 * a path that escapes the extraction dir (absolute or `..` traversal — "zip
 * slip"), or a symlink / hardlink / device / other non-regular entry (a symlink
 * could redirect a later member's write outside the dir). Only plain files and
 * directories are allowed. `tar -tzvf` prints one line per member, leading with
 * the type char of the mode string (`-` file, `d` dir, `l` symlink, `h`
 * hardlink, etc.); the member name is the last whitespace-separated field (links
 * render as "name -> target", so we cut at " -> "). Throws on the first offender.
 */
async function assertSafeTarball(tgz: string): Promise<void> {
  const { stdout } = await execFileAsync('tar', ['-tzvf', tgz])
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) continue
    const typeChar = line[0]
    // Only regular files (-) and directories (d) are permitted.
    if (typeChar !== '-' && typeChar !== 'd') {
      throw new Error(`unsafe tar entry (type '${typeChar}'): ${line}`)
    }
    // The member name is everything after the timestamp columns; cut any link
    // target, then take the trailing path token. The mode/owner/size/date
    // columns never contain a slash, so the first slash-bearing token onward is
    // the name — but to stay robust we just take the last field.
    const namePart = line.split(' -> ')[0]
    const fields = namePart.split(/\s+/)
    const name = fields[fields.length - 1]
    if (!name) continue
    if (path.isAbsolute(name) || name.startsWith('/')) {
      throw new Error(`unsafe tar entry (absolute path): ${name}`)
    }
    // Normalize and ensure it doesn't climb out with `..`.
    const normalized = path.normalize(name)
    if (normalized === '..' || normalized.startsWith('..' + path.sep) || normalized.includes(path.sep + '..' + path.sep)) {
      throw new Error(`unsafe tar entry (path traversal): ${name}`)
    }
  }
}

/**
 * Ensure a catalog entry is installed, returning its extracted root dir.
 * Idempotent: if the dir + .ok marker exist, returns immediately (unless `force`
 * is set, which re-downloads over the existing version — used by reinstall).
 * Otherwise downloads, verifies sha256 (if present), extracts the .tgz,
 * validates the extracted manifest.json, and writes .ok. Cleans up a partial
 * dir on failure.
 */
export async function installFromCatalog(entry: CatalogEntry, force = false): Promise<string> {
  const id = entry.manifest.id
  const version = entryVersion(entry)
  const dest = installedDir(id, version)

  if (!force && isInstalled(id, version)) return dest

  await mkdir(path.dirname(dest), { recursive: true })

  // Download the tarball to a temp file (atomic via rename), then extract into a
  // temp dir we rename into place so a half-extracted dir is never visible.
  const tgz = `${dest}.${process.pid}.tgz`
  const tmpDir = `${dest}.${process.pid}.tmp`

  try {
    // A REMOTE artifact MUST carry a sha256 — we can't trust bytes off the
    // network without pinning them. Local (file://, absolute, relative) dev
    // artifacts are exempt (the catalog distinguishes them the same way, via
    // isLocal). Checked before the download so we never fetch unpinned bytes.
    if (!isLocal(entry.artifactUrl) && !entry.sha256) {
      throw new Error(`remote artifact for ${id}@${version} is missing a required sha256`)
    }
    const buf = await readArtifact(entry.artifactUrl)
    if (entry.sha256 && sha256(buf) !== entry.sha256.toLowerCase()) {
      throw new Error(`sha256 mismatch for ${id}@${version}`)
    }
    const tgzTmp = `${tgz}.part`
    await writeFile(tgzTmp, buf)
    await rename(tgzTmp, tgz)

    // Reject zip-slip / symlink / other non-regular members BEFORE extracting,
    // so a malicious tarball can never write outside the temp dir.
    await assertSafeTarball(tgz)

    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    await execFileAsync('tar', ['-xzf', tgz, '-C', tmpDir])

    // The .tgz may contain the extension at its root or nested one level; accept
    // a top-level manifest.json, else a single subdir holding it.
    const root = await resolveExtractedRoot(tmpDir)
    const manifest = await loadManifestFromDir(root)
    if (!manifest) {
      throw new Error(`extracted artifact for ${id}@${version} has no valid manifest.json`)
    }

    await rm(dest, { recursive: true, force: true })
    await rename(root, dest)
    await writeFile(path.join(dest, '.ok'), '')
    log.info('[extensions] installed %s@%s -> %s', id, version, dest)
    return dest
  } catch (err) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    await rm(tgz, { force: true }).catch(() => {})
  }
}

/** Pick the extracted extension root: tmpDir itself if it holds a manifest,
 *  otherwise its single subdirectory (a tar that preserved a leading folder). */
async function resolveExtractedRoot(tmpDir: string): Promise<string> {
  if (existsSync(path.join(tmpDir, 'manifest.json'))) return tmpDir
  const entries = await readdir(tmpDir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())
  if (dirs.length === 1 && existsSync(path.join(tmpDir, dirs[0].name, 'manifest.json'))) {
    return path.join(tmpDir, dirs[0].name)
  }
  return tmpDir
}
