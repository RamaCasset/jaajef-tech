import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyQuest, StreakInfo } from '../lib/api'

const getDailyQuest = vi.fn()
const getMyStreak = vi.fn()
const loadProfile = vi.fn()
const listMyBlogPosts = vi.fn()

vi.mock('../lib/api', () => ({
  getDailyQuest: (...a: unknown[]) => getDailyQuest(...a),
  getMyStreak: (...a: unknown[]) => getMyStreak(...a),
  loadProfile: (...a: unknown[]) => loadProfile(...a),
  listMyBlogPosts: (...a: unknown[]) => listMyBlogPosts(...a),
  startConversation: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    member: { kopeks: 420, profile: { id: 'u1', username: 'moussa_dev', display_name: 'Moussa Diop', clan: 'saltigue', mastery: 'bagne', xp: 25000 } },
    session: { user: { id: 'u1' } },
    signOut: vi.fn(),
  }),
}))

import { Home } from '../pages/Home'

const quest = (extra: Partial<DailyQuest> = {}): DailyQuest => ({
  quest_id: 'q1', slug: 'la-malediction-du-loop', title: 'La Malédiction du Loop', summary: 'Brisez le cycle.', clan: 'saltigue', mastery: 'bagne',
  topic: 'Algorithmes', language: 'python', est_minutes: 25, xp_reward: 250, kopek_reward: 50, source: 'scheduled', day: '2026-11-06',
  seconds_left: 5 * 3600 + 12 * 60 + 30, status: null, ...extra,
})
const streak = (extra: Partial<StreakInfo> = {}): StreakInfo => ({
  current_streak: 4, longest_streak: 9, done_today: false, at_risk: true, chest_every: 7, chest_kopeks: 100, next_chest_in: 3,
  last_active_on: '2026-11-05', freezes: 1, freeze_max: 2, protected_by_freeze: false, ...extra,
})
const profileData = (extra = {}) => ({
  profile: { id: 'u1', username: 'moussa_dev', display_name: 'Moussa Diop', bio: 'Je construis des outils.', location: 'Dakar, Sénégal', github_username: 'moussa-diop', avatar_url: null, banner_url: null, clan: 'saltigue', mastery: 'bagne', xp: 25000, is_verified: false, available_to_collab: true, created_at: '2024-03-01T00:00:00Z' },
  xpPerLevel: 10000,
  badges: [
    { slug: 'first-quest', name: 'Première quête', description: 'Résolue', tier: 'common' },
    { slug: 'maker', name: 'Bâtisseur', description: null, tier: 'rare' },
  ],
  projects: [
    { id: 'p1', github_owner: 'moussa-diop', github_repo: 'teranga-ui', title: 'teranga-ui', summary: 'Composants accessibles', language: 'TypeScript', github_stars: 248, build_status: 'passing' },
    { id: 'p2', github_owner: 'moussa-diop', github_repo: 'jaajef-cli', title: 'jaajef-cli', summary: null, language: 'TypeScript', github_stars: 126, build_status: null },
  ],
  questsSolved: 128,
  appreciation: 342,
  ...extra,
})
const mount = () => render(<MemoryRouter><Home /></MemoryRouter>)

beforeEach(() => {
  for (const m of [getDailyQuest, getMyStreak, loadProfile, listMyBlogPosts]) m.mockReset()
  getDailyQuest.mockResolvedValue(quest())
  getMyStreak.mockResolvedValue(streak())
  loadProfile.mockResolvedValue(profileData())
  listMyBlogPosts.mockResolvedValue([
    { id: 'b1', slug: 'mon-article', title: 'Mon article', status: 'published', staff_hidden: false, updated_at: '2026-11-01T00:00:00Z' },
    { id: 'b2', slug: 'brouillon', title: 'Brouillon', status: 'draft', staff_hidden: false, updated_at: '2026-11-02T00:00:00Z' },
  ])
})

describe('Cité home', () => {
  it('shows an error with a retry when my page cannot be loaded, but still the quest', async () => {
    loadProfile.mockRejectedValueOnce(new Error('boom'))
    mount()
    expect(await screen.findByText('Impossible de charger votre page.')).toBeInTheDocument()
    loadProfile.mockResolvedValue(profileData())
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { name: 'Moussa Diop' })).toBeInTheDocument()
  })

  it('shows my own page like a profile: identity, level, and four numbers', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Moussa Diop' })).toBeInTheDocument()
    expect(loadProfile).toHaveBeenCalledWith('moussa_dev', 'u1')
    expect(screen.getByText('@moussa_dev')).toBeInTheDocument()
    expect(screen.getByText('Niveau 3 (5000 / 10000 XP)')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5000')
    expect(screen.getByRole('link', { name: 'Modifier mon profil' })).toHaveAttribute('href', '/parametres/profil')
    expect(screen.getByRole('link', { name: /Personnaliser la couverture/ })).toBeInTheDocument()
    const stats = document.querySelector('.profile-stats') as HTMLElement
    expect(within(stats).getByText('128')).toBeInTheDocument()
    expect(within(stats).getByText('Quêtes terminées')).toBeInTheDocument()
    expect(within(stats).getByText('XP total')).toBeInTheDocument()
    expect(within(stats).getByText('Projets')).toBeInTheDocument()
    expect(within(stats).getByText('342')).toBeInTheDocument()
    expect(within(stats).getByText('Étoiles et j’aimes reçus')).toBeInTheDocument()
  })

  it('shows my projects and badges, and opens the blog tab', async () => {
    mount()
    expect(await screen.findByRole('link', { name: 'moussa-diop / teranga-ui' })).toHaveAttribute('href', '/projets/p1')
    expect(screen.getByText('Première quête')).toBeInTheDocument()
    expect(screen.getByText('Bâtisseur')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Mes blogs' }))
    expect(await screen.findByRole('link', { name: 'Mon article' })).toHaveAttribute('href', '/blog/mon-article')
    expect(screen.queryByText('Brouillon')).toBeNull()
    expect(screen.queryByRole('tab', { name: /Badges/ })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Mes projets' })).toBeInTheDocument()
  })

  it('says so when I have no badge yet', async () => {
    loadProfile.mockResolvedValue(profileData({ badges: [] }))
    mount()
    expect(await screen.findByText(/Aucun badge débloqué/)).toBeInTheDocument()
  })

  it('shows the quest of the day with rewards and time left, and a link to start it', async () => {
    mount()
    expect(await screen.findByText('La Malédiction du Loop')).toBeInTheDocument()
    expect(screen.getByText(/25 min · \+250 XP · \+50 Kopeks · Il reste 5 h 12 min/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Commencer' })
    expect(link).toHaveAttribute('href', '/quetes/la-malediction-du-loop')
  })

  it('offers to resume a started quest and to review a solved one', async () => {
    getDailyQuest.mockResolvedValue(quest({ status: 'in_progress' }))
    const first = mount()
    expect(await screen.findByRole('link', { name: 'Reprendre' })).toBeInTheDocument()
    first.unmount()
    getDailyQuest.mockResolvedValue(quest({ status: 'solved' }))
    mount()
    expect(await screen.findByRole('link', { name: 'Revoir' })).toBeInTheDocument()
    expect(screen.getByText(/Déjà résolue aujourd'hui/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Commencer' })).toBeNull()
  })

  it('shows minutes only when less than an hour is left', async () => {
    getDailyQuest.mockResolvedValue(quest({ seconds_left: 45 * 60 }))
    mount()
    expect(await screen.findByText(/Il reste 45 min/)).toBeInTheDocument()
  })

  it('says so when there is no quest today', async () => {
    getDailyQuest.mockResolvedValue(null)
    mount()
    expect(await screen.findByText("Pas de quête aujourd'hui. Revenez bientôt.")).toBeInTheDocument()
  })

  it('shows the streak as a small line inside the quest box', async () => {
    mount()
    const line = await screen.findByLabelText('Série')
    expect(within(line).getByText('Série : 4 jours')).toBeInTheDocument()
    expect(within(line).getByText(/Record : 9 jours/)).toBeInTheDocument()
    expect(within(line).getByText("Résolvez une quête aujourd'hui pour garder votre série.")).toBeInTheDocument()
    expect(within(line).getByText('Coffre dans 3 jours : +100 Kopeks')).toBeInTheDocument()
    expect(within(line).getByText('Gels de série : 1 sur 2')).toBeInTheDocument()
  })

  it('keeps the other blocks when one of them fails', async () => {
    getDailyQuest.mockRejectedValue(new Error('boom'))
    mount()
    expect(await screen.findByText('Impossible de charger la quête du jour.')).toBeInTheDocument()
    expect(await screen.findByText('Première quête')).toBeInTheDocument()
    expect(await screen.findByText('Niveau 3 (5000 / 10000 XP)')).toBeInTheDocument()
  })

})
