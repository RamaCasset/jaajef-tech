import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileData } from '../lib/api'

const loadProfile = vi.fn()
vi.mock('../lib/api', () => ({ loadProfile: (...a: unknown[]) => loadProfile(...a) }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } }, member: { kopeks: 5, profile: { display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Profile } from '../pages/Profile'

const data = (extra: Partial<ProfileData> = {}): ProfileData => ({
  profile: {
    id: 'me', username: 'moussa', display_name: 'Moussa Diop', avatar_url: null, banner_url: null, bio: 'Je construis des outils.',
    location: 'Dakar, Sénégal', github_username: 'moussa-diop', clan: 'griot_du_code', mastery: 'borom_xam_xam', xp: 8450,
    available_to_collab: true, is_verified: true, created_at: '2024-03-10T00:00:00Z',
  },
  xpPerLevel: 10000,
  badges: [{ slug: 'b1', name: 'Maître Griot', description: '100 contributions', tier: 'common' }],
  projects: [{ id: 'p1', github_owner: 'moussa-diop', github_repo: 'teranga-ui', title: 'Teranga UI', summary: 'Composants accessibles', language: 'TypeScript', github_stars: 248, build_status: 'passing' }],
  questsSolved: 128,
  appreciation: 342,
  ...extra,
})

const mount = () => render(
  <MemoryRouter initialEntries={['/profil/moussa']}>
    <Routes><Route path="/profil/:username" element={<Profile />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => { loadProfile.mockReset(); loadProfile.mockResolvedValue(data()) })

describe('Profile page', () => {
  it('shows identity, level, projects and badges for the username in the address', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: /Moussa Diop/ })).toBeInTheDocument()
    expect(loadProfile).toHaveBeenCalledWith('moussa', 'me')
    expect(screen.getByText('@moussa')).toBeInTheDocument()
    expect(screen.getByText('Griot du Code')).toBeInTheDocument()
    expect(screen.getByText('Disponible pour collaborer')).toBeInTheDocument()
    expect(screen.getAllByText('Niveau 1 (8450 / 10000 XP)').length).toBeGreaterThan(0)
    expect(screen.getByText('1550 XP avant le niveau 2')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8450')
    expect(screen.getByText('moussa-diop / teranga-ui')).toBeInTheDocument()
    expect(screen.getByText('Build OK')).toBeInTheDocument()
    expect(screen.getByText('Maître Griot')).toBeInTheDocument()
    expect(screen.getByText('128')).toBeInTheDocument()
  })

  it("hides the quests count on someone else's profile", async () => {
    loadProfile.mockResolvedValue(data({ questsSolved: null }))
    mount()
    await screen.findByRole('heading', { name: /Moussa Diop/ })
    expect(screen.queryByText('Quêtes terminées')).not.toBeInTheDocument()
  })

  it('shows empty messages, not found, and error with retry', async () => {
    loadProfile.mockResolvedValueOnce(data({ badges: [], projects: [] }))
    const first = mount()
    expect(await screen.findByText(/Aucun projet publié/)).toBeInTheDocument()
    expect(screen.getByText(/Aucun badge débloqué/)).toBeInTheDocument()
    first.unmount()
    loadProfile.mockResolvedValueOnce(null)
    const second = mount()
    expect(await screen.findByText(/n'existe pas/)).toBeInTheDocument()
    second.unmount()
    loadProfile.mockRejectedValueOnce(new Error('x'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { name: /Moussa Diop/ })).toBeInTheDocument()
  })

  it('offers "Signaler" on someone else\'s profile but not on my own', async () => {
    const own = mount()
    await screen.findByRole('heading', { name: /Moussa Diop/ })
    expect(screen.queryByRole('button', { name: 'Signaler' })).not.toBeInTheDocument()
    own.unmount()
    const other = data()
    other.profile = { ...other.profile, id: 'u2' }
    loadProfile.mockResolvedValue(other)
    mount()
    expect(await screen.findByRole('button', { name: 'Signaler' })).toBeInTheDocument()
  })
})
