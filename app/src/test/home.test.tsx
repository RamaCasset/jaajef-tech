import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyQuest, StreakInfo } from '../lib/api'

const getDailyQuest = vi.fn()
const getMyStreak = vi.fn()
const getXpPerLevel = vi.fn()
const getRecentBadges = vi.fn()

vi.mock('../lib/api', () => ({
  getDailyQuest: (...a: unknown[]) => getDailyQuest(...a),
  getMyStreak: (...a: unknown[]) => getMyStreak(...a),
  getXpPerLevel: (...a: unknown[]) => getXpPerLevel(...a),
  getRecentBadges: (...a: unknown[]) => getRecentBadges(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    member: { kopeks: 420, profile: { id: 'u1', username: 'moussa_dev', display_name: 'Moussa Diop', clan: 'saltigue', mastery: 'bagne', xp: 25000 } },
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
const mount = () => render(<MemoryRouter><Home /></MemoryRouter>)

beforeEach(() => {
  for (const m of [getDailyQuest, getMyStreak, getXpPerLevel, getRecentBadges]) m.mockReset()
  getDailyQuest.mockResolvedValue(quest())
  getMyStreak.mockResolvedValue(streak())
  getXpPerLevel.mockResolvedValue(10000)
  getRecentBadges.mockResolvedValue([
    { slug: 'first-quest', name: 'Première quête', description: 'Résolue', tier: 'common' },
    { slug: 'maker', name: 'Bâtisseur', description: null, tier: 'rare' },
  ])
})

describe('Cité home', () => {
  it('greets the member and shows the level, the XP bar and the Kopeks', async () => {
    mount()
    expect(await screen.findByText('Bienvenue dans la Cité, Moussa Diop')).toBeInTheDocument()
    expect(await screen.findByText('Niveau 3')).toBeInTheDocument()
    expect(screen.getByText('5000 / 10000 XP')).toBeInTheDocument()
    expect(screen.getByText('5000 XP avant le niveau 4')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5000')
    expect(screen.getByText('420')).toBeInTheDocument()
    expect(screen.getAllByText('Saltigué').length).toBeGreaterThan(0)
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

  it('shows the streak, the record, the chest and the freezes, with a warning when it is at risk', async () => {
    mount()
    const card = await screen.findByRole('region', { name: 'Série' })
    expect(await within(card).findByText('4 jours')).toBeInTheDocument()
    expect(within(card).getByText("Résolvez une quête aujourd'hui pour garder votre série.")).toBeInTheDocument()
    expect(within(card).getByText('Record : 9 jours')).toBeInTheDocument()
    expect(within(card).getByText('Coffre dans 3 jours : +100 Kopeks')).toBeInTheDocument()
    expect(within(card).getByText('Gels de série : 1 sur 2')).toBeInTheDocument()
  })

  it('tells the other streak situations apart', async () => {
    getMyStreak.mockResolvedValue(streak({ done_today: true, at_risk: false }))
    const a = mount()
    expect(await screen.findByText("C'est fait pour aujourd'hui.")).toBeInTheDocument()
    expect(screen.queryByText(/pour garder votre série/)).toBeNull()
    a.unmount()
    getMyStreak.mockResolvedValue(streak({ protected_by_freeze: true }))
    const b = mount()
    expect(await screen.findByText(/protégée par un gel/)).toBeInTheDocument()
    expect(screen.queryByText(/pour garder votre série/)).toBeNull()
    b.unmount()
    getMyStreak.mockResolvedValue(streak({ current_streak: 0, at_risk: false, next_chest_in: 7, chest_kopeks: 0, freeze_max: 0, longest_streak: 0 }))
    mount()
    expect(await screen.findByText('0 jours')).toBeInTheDocument()
    expect(screen.getByText(/Aucune série en cours/)).toBeInTheDocument()
    expect(screen.queryByText(/Coffre dans/)).toBeNull()
    expect(screen.queryByText(/Gels de série/)).toBeNull()
  })

  it('lists the latest badges, or says there is none yet', async () => {
    const a = mount()
    expect(await screen.findByText('Première quête')).toBeInTheDocument()
    expect(screen.getByText('Bâtisseur')).toBeInTheDocument()
    expect(getRecentBadges).toHaveBeenCalledWith('u1')
    expect(screen.getByRole('link', { name: /Voir tous mes badges/ })).toHaveAttribute('href', '/profil/moussa_dev')
    a.unmount()
    getRecentBadges.mockResolvedValue([])
    mount()
    expect(await screen.findByText(/Pas encore de badge/)).toBeInTheDocument()
  })

  it('keeps the other blocks when one of them fails', async () => {
    getDailyQuest.mockRejectedValue(new Error('boom'))
    mount()
    expect(await screen.findByText('Impossible de charger la quête du jour.')).toBeInTheDocument()
    expect(await screen.findByText('4 jours')).toBeInTheDocument()
    expect(await screen.findByText('Première quête')).toBeInTheDocument()
    expect(await screen.findByText('Niveau 3')).toBeInTheDocument()
  })

  it('shows an error instead of a wrong level when the level setting cannot be read', async () => {
    getXpPerLevel.mockRejectedValue(new Error('boom'))
    mount()
    expect(await screen.findByText('Impossible de charger votre niveau.')).toBeInTheDocument()
    expect(screen.queryByText(/^Niveau \d/)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('has shortcuts to the other screens', async () => {
    mount()
    const nav = await screen.findByRole('region', { name: 'Raccourcis' })
    expect(within(nav).getByRole('link', { name: 'Quêtes' })).toHaveAttribute('href', '/quetes')
    expect(within(nav).getByRole('link', { name: 'Projets' })).toHaveAttribute('href', '/projets')
    expect(within(nav).getByRole('link', { name: 'Le Souk' })).toHaveAttribute('href', '/souk')
    expect(within(nav).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs')
    expect(within(nav).getByRole('link', { name: 'Mon profil' })).toHaveAttribute('href', '/profil/moussa_dev')
  })
})
