import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ listMyApplications: vi.fn(), withdrawApplication: vi.fn() }))
vi.mock('../lib/api', () => api)

import { MyApplications } from '../components/MyApplications'

const app = (id: string, status: string, extra = {}) => ({
  id, offer_id: `o${id}`, offer_title: `Poste ${id}`, employer_name: 'SunuStack', status, applied_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z', offer_open: true, has_cv: true, ...extra,
})
const mount = () => render(<MemoryRouter><MyApplications /></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  api.withdrawApplication.mockResolvedValue(undefined)
})

describe('My applications', () => {
  it('lists each application with its status in French and what it means', async () => {
    api.listMyApplications.mockResolvedValue([app('1', 'submitted'), app('2', 'shortlisted'), app('3', 'declined')])
    mount()
    expect(await screen.findByText('Envoyée')).toBeInTheDocument()
    expect(screen.getByText('Entretien')).toBeInTheDocument()
    expect(screen.getByText('Refusée')).toBeInTheDocument()
    expect(screen.getByText('Vous êtes invité à un entretien. Surveillez vos messages.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Poste 1' })).toHaveAttribute('href', '/jobs/o1')
  })

  it('says when the offer was closed, and does not link to it', async () => {
    api.listMyApplications.mockResolvedValue([app('1', 'seen', { offer_open: false })])
    mount()
    expect(await screen.findByText(/L'offre est maintenant fermée/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Poste 1' })).not.toBeInTheDocument()
  })

  it('withdraws an application, but only one that is still alive', async () => {
    api.listMyApplications.mockResolvedValue([app('1', 'submitted'), app('2', 'declined')])
    mount()
    await screen.findByText('Poste 1')
    expect(screen.getAllByRole('button', { name: 'Retirer ma candidature' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Retirer ma candidature' }))
    await waitFor(() => expect(api.withdrawApplication).toHaveBeenCalledWith('1'))
  })

  it('shows a message when there is nothing yet', async () => {
    api.listMyApplications.mockResolvedValue([])
    mount()
    expect(await screen.findByText("Aucune candidature pour l'instant.")).toBeInTheDocument()
  })
})
