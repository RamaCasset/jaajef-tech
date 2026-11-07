import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplicationFile as FileData, JobOfferDetail } from '../lib/api'

const getJobOffer = vi.fn()
const applyToOffer = vi.fn()
const myApplicationFile = vi.fn()
const saveApplicationFile = vi.fn()

vi.mock('../lib/api', () => ({
  getJobOffer: (...a: unknown[]) => getJobOffer(...a),
  applyToOffer: (...a: unknown[]) => applyToOffer(...a),
  myApplicationFile: (...a: unknown[]) => myApplicationFile(...a),
  saveApplicationFile: (...a: unknown[]) => saveApplicationFile(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { JobDetail } from '../pages/JobDetail'
import { ApplicationFile } from '../pages/ApplicationFile'

const offer: JobOfferDetail = {
  id: 'j1', title: 'Développeur React', kind: 'job', employment_type: 'full_time', location: 'Dakar', remote: 'hybrid',
  pay_min_fcfa: 900000, pay_max_fcfa: 1400000, pay_unit: 'month', pay_negotiable: false, tags: ['React'], closes_on: null,
  published_at: '2026-10-25T00:00:00Z', employer_id: 'e1', employer_name: 'SunuStack', employer_kind: 'company', employer_logo_url: null,
  description: 'Ligne un\nLigne deux <b>pas du html</b>',
}
const mountOffer = () => render(
  <MemoryRouter initialEntries={['/jobs/j1']}>
    <Routes>
      <Route path="/jobs/:id" element={<JobDetail />} />
      <Route path="/jobs" element={<p>list</p>} />
      <Route path="/dossier" element={<p>file page</p>} />
    </Routes>
  </MemoryRouter>,
)

const emptyFile: FileData = {
  headline: null, summary: null, location: null, experience_years: null, availability: null, work_kinds: [], skills: [],
  website: null, linkedin_url: null, cv_name: null, portfolio_count: 0, completion: 0, missing: ['headline', 'summary', 'skills', 'cv'],
}

beforeEach(() => {
  for (const m of [getJobOffer, applyToOffer, myApplicationFile, saveApplicationFile]) m.mockReset()
  getJobOffer.mockResolvedValue(offer)
  applyToOffer.mockResolvedValue('app1')
  myApplicationFile.mockResolvedValue(emptyFile)
  saveApplicationFile.mockResolvedValue(undefined)
})

describe('Job detail', () => {
  it('shows the offer, with the description as plain text (no html)', async () => {
    mountOffer()
    expect(await screen.findByRole('heading', { name: 'Développeur React' })).toBeInTheDocument()
    expect(screen.getByText(/SunuStack/)).toBeInTheDocument()
    expect(screen.getByText(/pas du html/)).toHaveTextContent('<b>pas du html</b>')
    expect(document.querySelector('p b')).toBeNull()
    expect(getJobOffer).toHaveBeenCalledWith('j1')
  })

  it('says so when the offer does not exist or is no longer online', async () => {
    getJobOffer.mockResolvedValue(null)
    mountOffer()
    expect(await screen.findByText(/n'existe pas ou n'est plus en ligne/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Envoyer ma candidature' })).not.toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    getJobOffer.mockRejectedValueOnce(new Error('down'))
    mountOffer()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { name: 'Développeur React' })).toBeInTheDocument()
  })

  it('sends the message and the CV choice, then confirms', async () => {
    mountOffer()
    await userEvent.type(await screen.findByLabelText(/Un mot pour le recruteur/), '  Bonjour  ')
    await userEvent.click(screen.getByLabelText('Joindre mon CV'))
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer ma candidature' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Candidature envoyée')
    expect(applyToOffer).toHaveBeenCalledWith('j1', '  Bonjour  ', false)
    expect(screen.queryByRole('button', { name: 'Envoyer ma candidature' })).not.toBeInTheDocument()
  })

  it('sends the CV by default', async () => {
    mountOffer()
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer ma candidature' }))
    await waitFor(() => expect(applyToOffer).toHaveBeenCalledWith('j1', '', true))
  })

  it('without an application file, explains and links to the file page', async () => {
    applyToOffer.mockRejectedValue(new Error('Add a headline to your application file first'))
    mountOffer()
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer ma candidature' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('dossier de candidature')
    await userEvent.click(screen.getByRole('link', { name: 'Remplir mon dossier' }))
    expect(screen.getByText('file page')).toBeInTheDocument()
  })

  it('shows "already applied" in French and keeps the form', async () => {
    applyToOffer.mockRejectedValue(new Error('You already applied to this offer'))
    mountOffer()
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer ma candidature' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà postulé')
    expect(screen.getByRole('button', { name: 'Envoyer ma candidature' })).toBeEnabled()
  })
})

describe('Application file', () => {
  const mountFile = () => render(<MemoryRouter><ApplicationFile /></MemoryRouter>)

  it('shows the completion and what is missing', async () => {
    myApplicationFile.mockResolvedValue({ ...emptyFile, headline: 'Dev', completion: 35, missing: ['summary', 'cv'] })
    mountFile()
    expect(await screen.findByText('Dossier complet à 35 %')).toBeInTheDocument()
    expect(screen.getByText('Un texte de présentation')).toBeInTheDocument()
    expect(screen.getByText('Votre CV (PDF)')).toBeInTheDocument()
    expect(screen.getByLabelText("Phrase d'accroche")).toHaveValue('Dev')
  })

  it('saves what was typed in the shape the database expects', async () => {
    mountFile()
    await userEvent.type(await screen.findByLabelText("Phrase d'accroche"), 'Dev web')
    await userEvent.type(screen.getByLabelText("Années d'expérience"), '4')
    await userEvent.selectOptions(screen.getByLabelText('Disponibilité'), 'immediate')
    await userEvent.click(screen.getByLabelText('Freelance'))
    await userEvent.type(screen.getByLabelText('Compétences'), 'React, , Python ')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Dossier enregistré')
    expect(saveApplicationFile).toHaveBeenCalledWith({
      headline: 'Dev web', summary: '', location: '', experience_years: 4, availability: 'immediate',
      work_kinds: ['freelance'], skills: ['React', 'Python'], website: '', linkedin_url: '',
    })
  })

  it('sends "no number" as null, not zero', async () => {
    mountFile()
    await userEvent.type(await screen.findByLabelText("Phrase d'accroche"), 'Dev')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(saveApplicationFile).toHaveBeenCalled())
    expect(saveApplicationFile.mock.calls[0][0]).toMatchObject({ experience_years: null, availability: null })
  })

  it('shows a refusal in French', async () => {
    saveApplicationFile.mockRejectedValue(new Error('The website must be a secure (https) address'))
    mountFile()
    await userEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('https://')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    myApplicationFile.mockRejectedValueOnce(new Error('down'))
    mountFile()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByLabelText("Phrase d'accroche")).toBeInTheDocument()
  })
})
