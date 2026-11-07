import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  searchTalent: vi.fn(),
  getTalent: vi.fn(),
  myTalentListing: vi.fn(),
  joinTalentDirectory: vi.fn(),
  leaveTalentDirectory: vi.fn(),
  startConversation: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Talents } from '../pages/Talents'
import { TalentProfile } from '../pages/TalentProfile'

const card = (n: number) => ({
  user_id: `u${n}`, username: `m${n}`, display_name: `Membre ${n}`, avatar_url: null, headline: `Dev numéro ${n}`, summary: null,
  location: 'Dakar', experience_years: 3, availability: 'immediate', work_kinds: ['job'], skills: ['React'], portfolio_count: 2, listed_at: '2026-11-01T00:00:00Z',
})
const detail = {
  user_id: 'u1', username: 'm1', display_name: 'Membre 1', avatar_url: null, headline: 'Dev React', summary: 'Ligne un\n<b>pas du html</b>',
  location: 'Dakar', experience_years: 3, availability: 'immediate', work_kinds: ['job'], skills: ['React', 'SQL'],
  website: 'https://moi.sn', linkedin_url: null, portfolio: [{ title: 'Mon site', description: null, url: 'https://moi.sn/site' }],
}
const mountList = () => render(<MemoryRouter><Talents /></MemoryRouter>)
const mountProfile = () => render(
  <MemoryRouter initialEntries={['/talents/u1']}>
    <Routes>
      <Route path="/talents/:id" element={<TalentProfile />} />
      <Route path="/messages/:id" element={<p>conversation ouverte</p>} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  api.searchTalent.mockResolvedValue([card(1), card(2)])
  api.myTalentListing.mockResolvedValue({ listed: false, visible: false, hidden_by_staff: false })
  api.joinTalentDirectory.mockResolvedValue(undefined)
  api.leaveTalentDirectory.mockResolvedValue(undefined)
  api.getTalent.mockResolvedValue(detail)
  api.startConversation.mockResolvedValue('c1')
})

describe('Talent directory', () => {
  it('lists the talents with a link to each profile', async () => {
    mountList()
    const link = await screen.findByRole('link', { name: 'Membre 2' })
    expect(link).toHaveAttribute('href', '/talents/u2')
    expect(screen.getByText('Dev numéro 1')).toBeInTheDocument()
  })

  it('shows an empty message', async () => {
    api.searchTalent.mockResolvedValue([])
    mountList()
    expect(await screen.findByText('Aucun talent ne correspond.')).toBeInTheDocument()
  })

  it('sends the chosen filters', async () => {
    mountList()
    await screen.findByText('Membre 1')
    await userEvent.selectOptions(screen.getByLabelText('Type de travail'), 'freelance')
    await userEvent.selectOptions(screen.getByLabelText('Disponibilité'), 'immediate')
    await waitFor(() => expect(api.searchTalent).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'freelance', availability: 'immediate' })))
  })

  it('offers a retry when the list fails', async () => {
    api.searchTalent.mockRejectedValueOnce(new Error('boom'))
    mountList()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Membre 1')).toBeInTheDocument()
  })

  it('lets a member join, and says so', async () => {
    mountList()
    await userEvent.click(await screen.findByRole('button', { name: "Apparaître dans l'annuaire" }))
    await waitFor(() => expect(api.joinTalentDirectory).toHaveBeenCalled())
    expect(await screen.findByText("Vous apparaissez dans l'annuaire.")).toBeInTheDocument()
  })

  it('explains in French when joining is refused', async () => {
    api.joinTalentDirectory.mockRejectedValue(new Error('Complete at least 60 percent of your application file to appear in the directory'))
    mountList()
    await userEvent.click(await screen.findByRole('button', { name: "Apparaître dans l'annuaire" }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Complétez davantage')
  })

  it('lets a listed member leave', async () => {
    api.myTalentListing.mockResolvedValue({ listed: true, visible: true, hidden_by_staff: false })
    mountList()
    await userEvent.click(await screen.findByRole('button', { name: "Quitter l'annuaire" }))
    await waitFor(() => expect(api.leaveTalentDirectory).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: "Apparaître dans l'annuaire" })).not.toBeInTheDocument()
  })

  it('tells a staff-hidden member their profile is hidden', async () => {
    api.myTalentListing.mockResolvedValue({ listed: true, visible: false, hidden_by_staff: true })
    mountList()
    expect(await screen.findByText(/masqué par l'équipe/)).toBeInTheDocument()
  })

  it('shows a profile as plain text with its portfolio', async () => {
    mountProfile()
    expect(await screen.findByText('Dev React')).toBeInTheDocument()
    expect(screen.getByText(/pas du html/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://moi.sn/site' })).toHaveAttribute('href', 'https://moi.sn/site')
    expect(api.getTalent).toHaveBeenCalledWith('u1')
  })

  it('opens a conversation with the talent', async () => {
    mountProfile()
    await userEvent.click(await screen.findByRole('button', { name: 'Écrire un message' }))
    await waitFor(() => expect(api.startConversation).toHaveBeenCalledWith('u1'))
    expect(await screen.findByText('conversation ouverte')).toBeInTheDocument()
  })

  it('shows a French message when the profile is gone', async () => {
    api.getTalent.mockRejectedValue(new Error('Profile not found'))
    mountProfile()
    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable')
  })
})
