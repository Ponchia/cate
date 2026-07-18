import { describe, expect, test } from 'vitest'
import { mintRuntimeId, isWsHost, stripWsToken } from './runtime'

describe('mintRuntimeId', () => {
  test('WSL ids carry the sanitized distro name as a readable prefix + a path hash', () => {
    expect(mintRuntimeId({ kind: 'wsl', distro: 'Ubuntu-22.04', distroPath: '/p' })).toMatch(/^wsl_Ubuntu-22\.04_[0-9a-f]{10}$/)
    expect(mintRuntimeId({ kind: 'wsl', distro: 'weird/name space', distroPath: '/p' })).toMatch(/^wsl_weird-name-space_[0-9a-f]{10}$/)
  })

  test('WSL ids are stable for the same distro+path', () => {
    const a = mintRuntimeId({ kind: 'wsl', distro: 'Ubuntu', distroPath: '/home/me/proj' })
    const a2 = mintRuntimeId({ kind: 'wsl', distro: 'Ubuntu', distroPath: '/home/me/proj' })
    expect(a).toBe(a2)
  })

  test('server ids are stable for the same target and differ across targets', () => {
    const a = mintRuntimeId({ kind: 'server', host: 'h', user: 'u', remotePath: '/p' })
    const a2 = mintRuntimeId({ kind: 'server', host: 'h', user: 'u', remotePath: '/p' })
    const b = mintRuntimeId({ kind: 'server', host: 'h2', user: 'u', remotePath: '/p' })
    expect(a).toBe(a2)
    expect(a).not.toBe(b)
    expect(a.startsWith('srv_')).toBe(true)
  })

  test('server port participates in identity', () => {
    const def = mintRuntimeId({ kind: 'server', host: 'h', user: 'u', remotePath: '/p' })
    const alt = mintRuntimeId({ kind: 'server', host: 'h', user: 'u', port: 2222, remotePath: '/p' })
    expect(def).not.toBe(alt)
  })

  // The path is part of the identity for BOTH transports: each daemon sandboxes
  // to a single --root, so two workspaces at different paths must get distinct ids
  // (otherwise the second reuses the first daemon and its path falls outside that
  // daemon's allowed root).
  test('the path participates in identity for both server and WSL ids', () => {
    const srvA = mintRuntimeId({ kind: 'server', host: 'h', user: 'u', remotePath: '/a' })
    const srvB = mintRuntimeId({ kind: 'server', host: 'h', user: 'u', remotePath: '/b' })
    expect(srvA).not.toBe(srvB)

    const wslA = mintRuntimeId({ kind: 'wsl', distro: 'Ubuntu', distroPath: '/home/me/a' })
    const wslB = mintRuntimeId({ kind: 'wsl', distro: 'Ubuntu', distroPath: '/home/me/b' })
    expect(wslA).not.toBe(wslB)
  })

  // ws:// targets: ONE persistent daemon serves many roots, so the id hashes
  // only the token-stripped URL — same URL + different paths share a runtime,
  // and rotating the token never changes the id.
  test('ws ids ignore the path and the token', () => {
    const a = mintRuntimeId({ kind: 'server', host: 'ws://h:7777/?token=aaa', user: '', remotePath: '/a' })
    const b = mintRuntimeId({ kind: 'server', host: 'ws://h:7777/?token=bbb', user: '', remotePath: '/b' })
    const c = mintRuntimeId({ kind: 'server', host: 'ws://other:7777', user: '', remotePath: '/a' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('srv_')).toBe(true)
  })
})

describe('ws host helpers', () => {
  test('isWsHost detects ws/wss URLs only', () => {
    expect(isWsHost('ws://h:7777')).toBe(true)
    expect(isWsHost('wss://h/runtime')).toBe(true)
    expect(isWsHost('h.example.com')).toBe(false)
    expect(isWsHost('user@h:22')).toBe(false)
  })

  test('stripWsToken removes the token and returns it separately', () => {
    const { url, token } = stripWsToken('ws://h:7777/?token=sekret&x=1')
    expect(token).toBe('sekret')
    expect(url).toBe('ws://h:7777/?x=1')
    expect(stripWsToken('ws://h:7777/').token).toBeUndefined()
  })
})
