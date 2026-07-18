// =============================================================================
// repoMatch — nearest-enclosing-repo resolution for container workspaces.
//
// A "container" workspace roots at a folder OF repos (e.g. ~/bronto holding 30
// checkouts) rather than a repo. Git identity is then a PER-PANEL context: a
// terminal's cwd or an editor's file belongs to whichever inventoried repo is
// its nearest ancestor. This is the one pure primitive everything else builds
// on; inputs are locator strings (or bare paths — any consistent scheme works,
// the comparison is purely lexical with '/' boundaries).
// =============================================================================

/** Longest repo whose path is `path` itself or a proper ancestor of it.
 *  Returns null when no inventoried repo encloses the path. */
export function nearestRepoFor(
  repos: readonly string[],
  path: string | null | undefined,
): string | null {
  if (!path) return null
  let best: string | null = null
  for (const repo of repos) {
    if (path !== repo && !path.startsWith(repo.endsWith('/') ? repo : repo + '/')) continue
    if (best === null || repo.length > best.length) best = repo
  }
  return best
}

/** Human label for a repo locator/path: its basename. */
export function repoDisplayName(repo: string): string {
  const trimmed = repo.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}
