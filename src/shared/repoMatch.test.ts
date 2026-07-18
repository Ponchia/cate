import { describe, expect, it } from 'vitest'
import { nearestRepoFor, repoDisplayName } from './repoMatch'

const REPOS = [
  'cate-runtime://srv_x/home/ubuntu/bronto/hometolotto',
  'cate-runtime://srv_x/home/ubuntu/bronto/cate-fork/upstream',
  'cate-runtime://srv_x/home/ubuntu/bronto/cate-fork',
  'cate-runtime://srv_x/home/ubuntu/hive/vpp-frontend',
]

describe('nearestRepoFor', () => {
  it('matches a path inside a repo to that repo', () => {
    expect(nearestRepoFor(REPOS, 'cate-runtime://srv_x/home/ubuntu/bronto/hometolotto/src/app.py'))
      .toBe('cate-runtime://srv_x/home/ubuntu/bronto/hometolotto')
  })

  it('picks the DEEPEST enclosing repo (nested checkouts)', () => {
    expect(nearestRepoFor(REPOS, 'cate-runtime://srv_x/home/ubuntu/bronto/cate-fork/upstream/src/main.ts'))
      .toBe('cate-runtime://srv_x/home/ubuntu/bronto/cate-fork/upstream')
  })

  it('a repo root path matches itself', () => {
    expect(nearestRepoFor(REPOS, 'cate-runtime://srv_x/home/ubuntu/bronto/cate-fork'))
      .toBe('cate-runtime://srv_x/home/ubuntu/bronto/cate-fork')
  })

  it('does not prefix-match sibling names (bronto/cate-fork2)', () => {
    expect(nearestRepoFor(REPOS, 'cate-runtime://srv_x/home/ubuntu/bronto/cate-fork2/file'))
      .toBe(null)
  })

  it('container root and unrelated paths resolve to null', () => {
    expect(nearestRepoFor(REPOS, 'cate-runtime://srv_x/home/ubuntu/bronto')).toBe(null)
    expect(nearestRepoFor(REPOS, undefined)).toBe(null)
    expect(nearestRepoFor([], '/anything')).toBe(null)
  })
})

describe('repoDisplayName', () => {
  it('is the basename', () => {
    expect(repoDisplayName('cate-runtime://srv_x/home/ubuntu/bronto/hometolotto')).toBe('hometolotto')
    expect(repoDisplayName('/Users/zeno/projects/cate/')).toBe('cate')
  })
})
