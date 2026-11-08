import { describe, expect, it } from 'vitest'
import { getRepoTree, loadBranches, pullRequestUrl } from '../lib/api'

const reply = (routes: Record<string, unknown>) => (async (url: string) => {
  const hit = Object.keys(routes).find((k) => String(url).endsWith(k))
  return hit ? new Response(JSON.stringify(routes[hit]), { status: 200 }) : new Response('{}', { status: 404 })
}) as unknown as typeof fetch

describe('Branches: reading helpers', () => {
  it('reads the files of the branch asked for, and reports the main branch', async () => {
    const seen: string[] = []
    const f = (async (url: string) => {
      seen.push(String(url))
      if (String(url).endsWith('/repos/awa/appli')) return new Response(JSON.stringify({ default_branch: 'main' }))
      return new Response(JSON.stringify({ tree: [{ path: 'a.py', type: 'blob', size: 3 }], truncated: false }))
    }) as unknown as typeof fetch
    const side = await getRepoTree('awa', 'appli', 'ndeye_k/fix', f)
    expect([side.branch, side.default_branch]).toEqual(['ndeye_k/fix', 'main'])
    expect(seen[1]).toContain('/git/trees/ndeye_k%2Ffix?recursive=1')
    const main = await getRepoTree('awa', 'appli', null, f)
    expect(main.branch).toBe('main')
  })

  it('lists the branches of a public repository with the main one named', async () => {
    const f = reply({ '/repos/awa/appli': { default_branch: 'main' }, '/branches?per_page=100': [{ name: 'main' }, { name: 'ndeye_k/fix' }] })
    expect(await loadBranches({ id: 'p1', github_owner: 'awa', github_repo: 'appli', repo_private: false }, f)).toEqual({ default_branch: 'main', branches: ['main', 'ndeye_k/fix'] })
    await expect(loadBranches({ id: 'p1', github_owner: 'a/b', github_repo: 'appli', repo_private: false }, f)).rejects.toThrow()
  })

  it('builds the GitHub address that opens a pull request for a branch', () => {
    expect(pullRequestUrl('awa', 'appli', 'main', 'ndeye_k/fix readme')).toBe('https://github.com/awa/appli/compare/main...ndeye_k/fix%20readme?expand=1')
  })
})
