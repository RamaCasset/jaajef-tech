import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))
vi.mock('../lib/api', () => ({}))

import { Guide } from '../pages/Guide'
import { fr } from '../i18n/fr'

describe('Guide', () => {
  it('shows every section in order', () => {
    render(<MemoryRouter><Guide /></MemoryRouter>)
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual(fr.guide.sections.map((s, i) => `${i + 1}. ${s.title}`))
  })

  it('links each screen it describes', () => {
    render(<MemoryRouter><Guide /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Visiter le Souk' })).toHaveAttribute('href', '/souk')
    expect(screen.getByRole('link', { name: 'Voir les quêtes' })).toHaveAttribute('href', '/quetes')
    expect(screen.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/jobs')
  })

  it('every link in the guide points at a real route', async () => {
    const routes = (await import('../routes?raw')).default as string
    for (const s of fr.guide.sections) {
      if ('to' in s && s.to) expect(routes).toContain(`path="${s.to}"`)
    }
  })
})
