import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const h = vi.hoisted(() => ({ userData: '', appPath: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.userData, getAppPath: () => h.appPath },
}))

import { installFromCatalog, isInstalled, installedDir } from './download'
import type { CatalogEntry } from './catalog'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'cate-download-'))
  h.userData = path.join(tmp, 'userData')
  h.appPath = tmp
  mkdirSync(h.userData, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/** Build a hello.tgz from a minimal extension folder; return file path + sha256. */
function buildArtifact(id = 'cate.hello', version = '0.1.0'): { file: string; sha256: string } {
  const srcDir = path.join(tmp, 'ext-src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(
    path.join(srcDir, 'manifest.json'),
    JSON.stringify({ id, name: 'Hello', version, panels: [{ id: 'main', label: 'Hello' }], frontend: 'index.html' }),
  )
  writeFileSync(path.join(srcDir, 'index.html'), '<!doctype html><h1>hi</h1>')
  const file = path.join(tmp, `${id}-${version}.tgz`)
  execFileSync('tar', ['-czf', file, '-C', srcDir, '.'])
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  return { file, sha256 }
}

function entryFor(file: string, sha256?: string, id = 'cate.hello', version = '0.1.0'): CatalogEntry {
  return {
    manifest: { id, name: 'Hello', version, panels: [{ id: 'main', label: 'Hello' }] },
    artifactUrl: pathToFileURL(file).toString(),
    sha256,
  }
}

/** Build a tarball whose payload also contains a malicious member (a symlink
 *  escaping the dir, or a `..` traversal path). Returns the tarball path. */
function buildMaliciousArtifact(kind: 'symlink' | 'traversal'): string {
  const srcDir = path.join(tmp, `evil-src-${kind}`)
  mkdirSync(srcDir, { recursive: true })
  // A valid manifest so the only reason to reject is the malicious member.
  writeFileSync(
    path.join(srcDir, 'manifest.json'),
    JSON.stringify({ id: 'cate.evil', name: 'Evil', version: '0.1.0', panels: [{ id: 'main', label: 'Evil' }], frontend: 'index.html' }),
  )
  writeFileSync(path.join(srcDir, 'index.html'), '<!doctype html>')
  const file = path.join(tmp, `cate.evil-${kind}.tgz`)
  if (kind === 'symlink') {
    // A symlink that points outside the extraction dir (classic redirect).
    execFileSync('ln', ['-s', '/etc/passwd', path.join(srcDir, 'pwned')])
    execFileSync('tar', ['-czf', file, '-C', srcDir, '.'])
  } else {
    // A member whose name literally traverses out of the dir ("../escape"),
    // injected via tar's name-rewrite. BSD tar (macOS) uses -s; GNU tar (Linux
    // CI) uses --transform — try BSD first, fall back to GNU.
    writeFileSync(path.join(srcDir, 'escape'), 'owned')
    try {
      execFileSync('tar', ['-czf', file, '-C', srcDir, '-s', '|^escape$|../escape|', 'escape', 'manifest.json', 'index.html'])
    } catch {
      execFileSync('tar', ['-czf', file, '-C', srcDir, '--transform', 's|^escape$|../escape|', 'escape', 'manifest.json', 'index.html'])
    }
  }
  return file
}

describe('installFromCatalog', () => {
  it('downloads + extracts a local file:// artifact and writes the .ok marker', async () => {
    const { file } = buildArtifact()
    const root = await installFromCatalog(entryFor(file))
    expect(root).toBe(installedDir('cate.hello', '0.1.0'))
    expect(existsSync(path.join(root, 'manifest.json'))).toBe(true)
    expect(existsSync(path.join(root, 'index.html'))).toBe(true)
    expect(isInstalled('cate.hello', '0.1.0')).toBe(true)
  })

  it('is idempotent: a second install short-circuits on the .ok marker', async () => {
    const { file } = buildArtifact()
    const entry = entryFor(file)
    const first = await installFromCatalog(entry)
    // Removing the source artifact proves the second call does no extraction.
    rmSync(file)
    const second = await installFromCatalog(entry)
    expect(second).toBe(first)
    expect(isInstalled('cate.hello', '0.1.0')).toBe(true)
  })

  it('verifies sha256 and installs when it matches', async () => {
    const { file, sha256 } = buildArtifact()
    const root = await installFromCatalog(entryFor(file, sha256))
    expect(existsSync(path.join(root, '.ok'))).toBe(true)
  })

  it('throws on sha256 mismatch and leaves nothing installed', async () => {
    const { file } = buildArtifact()
    const bad = 'f'.repeat(64)
    await expect(installFromCatalog(entryFor(file, bad))).rejects.toThrow(/sha256 mismatch/)
    expect(isInstalled('cate.hello', '0.1.0')).toBe(false)
    expect(existsSync(installedDir('cate.hello', '0.1.0'))).toBe(false)
  })

  it('rejects a remote (https) artifact that is missing a sha256, without downloading', async () => {
    // No network call should happen — the missing-sha256 guard fires first. If
    // it didn't, fetch() to this host would throw a different error.
    const entry: CatalogEntry = {
      manifest: { id: 'cate.remote', name: 'Remote', version: '0.1.0', panels: [{ id: 'm', label: 'M' }] },
      artifactUrl: 'https://example.invalid/cate.remote-0.1.0.tgz',
    }
    await expect(installFromCatalog(entry)).rejects.toThrow(/missing a required sha256/)
    expect(isInstalled('cate.remote', '0.1.0')).toBe(false)
  })

  it('rejects a tarball containing a symlink member and installs nothing', async () => {
    const file = buildMaliciousArtifact('symlink')
    await expect(installFromCatalog(entryFor(file, undefined, 'cate.evil', '0.1.0'))).rejects.toThrow(/unsafe tar entry/)
    expect(isInstalled('cate.evil', '0.1.0')).toBe(false)
    expect(existsSync(installedDir('cate.evil', '0.1.0'))).toBe(false)
  })

  it('rejects a tarball with a path-traversal (../) member and installs nothing', async () => {
    const file = buildMaliciousArtifact('traversal')
    await expect(installFromCatalog(entryFor(file, undefined, 'cate.evil', '0.1.0'))).rejects.toThrow(/unsafe tar entry/)
    expect(isInstalled('cate.evil', '0.1.0')).toBe(false)
  })

  it('resolves a relative artifactUrl against the app path', async () => {
    const { file } = buildArtifact('cate.rel', '0.1.0')
    const rel = path.relative(h.appPath, file)
    const entry: CatalogEntry = {
      manifest: { id: 'cate.rel', name: 'Rel', version: '0.1.0', panels: [{ id: 'm', label: 'M' }] },
      artifactUrl: './' + rel,
    }
    const root = await installFromCatalog(entry)
    expect(existsSync(path.join(root, 'manifest.json'))).toBe(true)
  })
})
