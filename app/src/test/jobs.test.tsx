import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobOffer } from '../lib/api'

const searchJobs = vi.fn()
const listSavedOffers = vi.fn()
const saveOffer = vi.fn()
const unsaveOffer = vi.fn()
const listMyApplications = vi.fn()
const withdrawApplication = vi.fn()

vi.mock('../lib/api', () => ({
  searchJobs: (...a: unknown[]) => searchJobs(...a),
  listSavedOffers: (...a: unknown[]) => listSavedOffers(...a),
  saveOffer: (...a: unknown[]) => saveOffer(...a),
  unsaveOffer: (...a: unknown[]) => unsaveOffer(...a),
  listMyApplications: (...a: unknown[]) => listMyApplications(...a),
  withdrawApplication: (...a: unknown[]) => withdrawApplication(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Jobs } from '../pages/Jobs'

const job = (n: number, extra: Partial<JobOffer> = {}): JobOffer => ({
  id: `j${n}`, title: `Poste ${n}`, kind: 'job', employment_type: 'full_time', location: 'Dakar', remote: 'hybrid',
  pay_min_fcfa: 900000, pay_max_fcfa: 1400000, pay_unit: 'month', pay_negotiable: false, tags: ['React'], closes_on: null,
  published_at: '2026-10-25T00:00:00Z', employer_id: 'e1', employer_name: 'SunuStack', employer_kind: 'company', employer_logo_url: null, ...extra,
})
const lastFilters = () => searchJobs.mock.calls[searchJobs.mock.calls.length - 1][0] as Record<string, unknown>
const mount = () => render(<MemoryRouter><Jobs /></MemoryRouter>)

beforeEach(() => {
  for (const m of [searchJobs, listSavedOffers, saveOffer, unsaveOffer, listMyApplications, withdrawApplication]) m.mockReset()
  searchJobs.mockResolvedValue([job(1), job(2, { kind: 'freelance', employment_type: null, pay_min_fcfa: null, pay_max_fcfa: null, pay_unit: null, pay_negotiable: true })])
  listSavedOffers.mockResolvedValue([{ offer_id: 'j2', title: 'Poste 2', kind: 'freelance', location: 'Dakar', remote: 'remote', employer_name: 'SunuStack', closes_on: null, is_listed: false, saved_at: '2026-10-26' }])
  saveOffer.mockResolvedValue(undefined)
  unsaveOffer.mockResolvedValue(undefined)
  listMyApplications.mockResolvedValue([])
})

describe('Jobs page', () => {
  it('lists offers with company, place, contract, tags and pay', async () => {
    mount()
    expect(await screen.findByText('Poste 1')).toBeInTheDocument()
    expect(screen.getByText('2 offres')).toBeInTheDocument()
    expect(screen.getByText(/900\s?000 - 1\s?400\s?000 FCFA \/ mois/)).toBeInTheDocument()
    expect(screen.getAllByText('CDI / temps plein').some((el) => el.className === 'tag')).toBe(true)
    expect(screen.getAllByText('React').length).toBe(2)
    expect(screen.getByText('Salaire à négocier')).toBeInTheDocument()
  })

  it('sends the filters to the database', async () => {
    mount()
    await screen.findByText('Poste 1')
    await userEvent.selectOptions(screen.getByLabelText('Lieu de travail'), 'remote')
    await waitFor(() => expect(lastFilters().remote).toBe('remote'))
    await userEvent.selectOptions(screen.getByLabelText('Contrat'), 'internship')
    await waitFor(() => expect(lastFilters().contract).toBe('internship'))
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'freelance')
    await waitFor(() => expect(lastFilters().kind).toBe('freelance'))
    await userEvent.selectOptions(screen.getByLabelText('Trier par'), 'pay')
    await waitFor(() => expect(lastFilters().sort).toBe('pay'))
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    await waitFor(() => expect(lastFilters()).toMatchObject({ remote: '', contract: '', kind: '', sort: 'recent' }))
  })

  it('searches after typing stops, not on every letter', async () => {
    mount()
    await screen.findByText('Poste 1')
    const slow = userEvent.setup({ delay: 60 })
    await slow.type(screen.getByRole('searchbox'), 'react')
    await waitFor(() => expect(searchJobs.mock.calls.some((c) => c[0].query === 'react')).toBe(true), { timeout: 2000 })
    expect(searchJobs.mock.calls.filter((c) => c[0].query && c[0].query !== 'react')).toEqual([])
  })

  it('saves and removes an offer with the star', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Sauvegarder : Poste 1' }))
    await waitFor(() => expect(saveOffer).toHaveBeenCalledWith('j1'))
    await userEvent.click(screen.getByRole('button', { name: 'Retirer des sauvegardes : Poste 2' }))
    await waitFor(() => expect(unsaveOffer).toHaveBeenCalledWith('j2'))
  })

  it('shows a plain message when the save limit is reached', async () => {
    saveOffer.mockRejectedValue(new Error('You have saved as many offers as allowed. Remove some first.'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Sauvegarder : Poste 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("maximum d'offres sauvegardées")
  })

  it('shows saved offers, flags ones no longer online, and applications with their status', async () => {
    listMyApplications.mockResolvedValue([{ id: 'a1', offer_id: 'j1', offer_title: 'Poste 1', employer_name: 'SunuStack', status: 'shortlisted', applied_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-28T00:00:00Z', offer_open: true, has_cv: true }])
    mount()
    await screen.findByText('Poste 1')
    await userEvent.click(screen.getByRole('tab', { name: 'Sauvegardées' }))
    expect(await screen.findByText('Plus en ligne')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Mes candidatures' }))
    expect(await screen.findByText('Entretien')).toBeInTheDocument()
  })

  it('withdraws an application after a click, and offers no button for ones already closed', async () => {
    const app = (id: string, status: string) => ({ id, offer_id: 'j1', offer_title: `Poste ${id}`, employer_name: 'SunuStack', status, applied_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-28T00:00:00Z', offer_open: true, has_cv: true })
    listMyApplications.mockResolvedValueOnce([app('a1', 'submitted'), app('a2', 'declined'), app('a3', 'withdrawn')])
    withdrawApplication.mockResolvedValue(undefined)
    mount()
    await screen.findByText('Poste 1')
    await userEvent.click(screen.getByRole('tab', { name: 'Mes candidatures' }))
    expect(await screen.findByRole('link', { name: 'Poste a1' })).toHaveAttribute('href', '/jobs/j1')
    expect(screen.getAllByRole('button', { name: 'Retirer ma candidature' })).toHaveLength(1)
    listMyApplications.mockResolvedValueOnce([app('a1', 'withdrawn'), app('a2', 'declined'), app('a3', 'withdrawn')])
    await userEvent.click(screen.getByRole('button', { name: 'Retirer ma candidature' }))
    expect(withdrawApplication).toHaveBeenCalledWith('a1')
    expect(await screen.findByRole('status')).toHaveTextContent('Candidature retirée')
    expect(screen.queryByRole('button', { name: 'Retirer ma candidature' })).not.toBeInTheDocument()
  })

  it('links each offer to its page', async () => {
    mount()
    expect(await screen.findByRole('link', { name: 'Poste 1' })).toHaveAttribute('href', '/jobs/j1')
    expect(screen.getByRole('link', { name: 'Mon dossier de candidature' })).toHaveAttribute('href', '/dossier')
  })

  it('shows the empty state and the error state with retry', async () => {
    searchJobs.mockResolvedValueOnce([])
    const first = mount()
    expect(await screen.findByText(/Aucune offre ne correspond/)).toBeInTheDocument()
    first.unmount()
    searchJobs.mockRejectedValueOnce(new Error('x'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Poste 1')).toBeInTheDocument()
  })
})
