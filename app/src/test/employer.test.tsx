import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getMyEmployer: vi.fn(), createEmployer: vi.fn(), updateEmployer: vi.fn(),
  listMyOffers: vi.fn(), getMyOffer: vi.fn(), createJobOffer: vi.fn(), updateJobOffer: vi.fn(),
  publishJobOffer: vi.fn(), closeJobOffer: vi.fn(), unpublishJobOffer: vi.fn(), deleteJobOffer: vi.fn(),
  listOfferApplicants: vi.fn(), setApplicationStatus: vi.fn(), getApplicationDetail: vi.fn(),
  applicantCvLink: vi.fn(), startConversation: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Employer } from '../pages/Employer'
import { OfferForm } from '../pages/OfferForm'
import { OfferApplicants } from '../pages/OfferApplicants'

const emp = (status: 'pending' | 'approved' | 'rejected' = 'approved', note: string | null = null) => ({
  id: 'e1', kind: 'company', name: 'SunuStack', description: null, website: null, logo_url: null, location: null, status, review_note: note,
})
const offer = (id: string, status: string, extra = {}) => ({
  id, title: `Offre ${id}`, kind: 'job', description: 'Texte', employment_type: 'full_time', location: 'Dakar', remote: 'onsite',
  pay_min_fcfa: 500000, pay_max_fcfa: 900000, pay_unit: 'month', pay_negotiable: false, tags: ['React', 'SQL'], status, review_note: null,
  staff_hidden: false, closes_on: null, ...extra,
})
const mountHub = () => render(<MemoryRouter><Employer /></MemoryRouter>)
const mountForm = (path = '/employeur/offres/nouvelle') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/employeur/offres/nouvelle" element={<OfferForm />} />
      <Route path="/employeur/offres/:id" element={<OfferForm />} />
      <Route path="/employeur" element={<p>hub</p>} />
    </Routes>
  </MemoryRouter>,
)
const applicant = (n: number, status = 'submitted') => ({
  id: `a${n}`, applicant_id: `u${n}`, username: `m${n}`, display_name: `Candidat ${n}`, avatar_url: null, headline: `Dev ${n}`,
  skills: ['React'], status, applied_at: '2026-11-01T00:00:00Z', has_cv: true,
})
const mountApplicants = () => render(
  <MemoryRouter initialEntries={['/employeur/offres/o1/candidatures']}>
    <Routes>
      <Route path="/employeur/offres/:id/candidatures" element={<OfferApplicants />} />
      <Route path="/messages/:id" element={<p>conversation ouverte</p>} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  api.getMyEmployer.mockResolvedValue(emp())
  api.listMyOffers.mockResolvedValue([])
  for (const k of ['createEmployer', 'updateEmployer', 'createJobOffer', 'updateJobOffer', 'closeJobOffer', 'unpublishJobOffer', 'deleteJobOffer', 'setApplicationStatus'] as const) api[k].mockResolvedValue(undefined)
  api.publishJobOffer.mockResolvedValue('published')
  api.listOfferApplicants.mockResolvedValue([applicant(1), applicant(2, 'seen')])
  api.startConversation.mockResolvedValue('c1')
})

describe('Employer hub', () => {
  it('lets a member create an employer profile', async () => {
    api.getMyEmployer.mockResolvedValue(null)
    mountHub()
    await userEvent.selectOptions(await screen.findByLabelText('Vous êtes'), 'individual')
    await userEvent.type(screen.getByLabelText('Nom'), 'Awa Diop')
    await userEvent.click(screen.getByRole('button', { name: 'Créer mon profil' }))
    await waitFor(() => expect(api.createEmployer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'individual', name: 'Awa Diop' })))
  })

  it('shows the profile status and a refusal reason', async () => {
    api.getMyEmployer.mockResolvedValue(emp('rejected', 'Site introuvable'))
    mountHub()
    expect(await screen.findByText(/a été refusé/)).toBeInTheDocument()
    expect(screen.getByText('Motif : Site introuvable')).toBeInTheDocument()
  })

  it('publishes a draft and says when it goes to review', async () => {
    api.listMyOffers.mockResolvedValue([offer('o1', 'draft')])
    api.publishJobOffer.mockResolvedValue('pending_review')
    mountHub()
    await userEvent.click(await screen.findByRole('button', { name: 'Publier : Offre o1' }))
    await waitFor(() => expect(api.publishJobOffer).toHaveBeenCalledWith('o1'))
    expect(await screen.findByText(/envoyée à l'équipe pour relecture/)).toBeInTheDocument()
  })

  it('offers only the actions that fit each status', async () => {
    api.listMyOffers.mockResolvedValue([offer('d', 'draft'), offer('p', 'published')])
    mountHub()
    await screen.findByText('Offre d')
    expect(screen.getByRole('button', { name: 'Publier : Offre d' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fermer : Offre d' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fermer : Offre p' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publier : Offre p' })).not.toBeInTheDocument()
  })

  it('closes the right offer', async () => {
    api.listMyOffers.mockResolvedValue([offer('a', 'published'), offer('b', 'published')])
    mountHub()
    await userEvent.click(await screen.findByRole('button', { name: 'Fermer : Offre b' }))
    await waitFor(() => expect(api.closeJobOffer).toHaveBeenCalledWith('b'))
  })

  it('asks before deleting, and does not delete when refused', async () => {
    api.listMyOffers.mockResolvedValue([offer('a', 'draft')])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mountHub()
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer : Offre a' }))
    expect(confirm).toHaveBeenCalled()
    expect(api.deleteJobOffer).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer : Offre a' }))
    await waitFor(() => expect(api.deleteJobOffer).toHaveBeenCalledWith('a'))
    confirm.mockRestore()
  })

  it('shows a French message when publishing is refused', async () => {
    api.listMyOffers.mockResolvedValue([offer('a', 'draft')])
    api.publishJobOffer.mockRejectedValue(new Error('Your company is waiting for approval'))
    mountHub()
    await userEvent.click(await screen.findByRole('button', { name: 'Publier : Offre a' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("attend d'être validée")
  })
})

describe('Offer form', () => {
  it('creates and publishes with the typed values', async () => {
    mountForm()
    await userEvent.type(await screen.findByLabelText('Titre'), 'Dev React')
    await userEvent.type(screen.getByLabelText('Description'), 'Un super poste')
    await userEvent.type(screen.getByLabelText('Rémunération minimale (FCFA)'), '600000')
    await userEvent.type(screen.getByLabelText('Mots-clés (séparés par des virgules)'), 'React, SQL')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer et publier' }))
    await waitFor(() => expect(api.createJobOffer).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dev React', pay_min: '600000', tags: 'React, SQL' }), true))
    expect(await screen.findByText('hub')).toBeInTheDocument()
  })

  it('saves a draft without publishing', async () => {
    mountForm()
    await userEvent.type(await screen.findByLabelText('Titre'), 'Dev React')
    await userEvent.type(screen.getByLabelText('Description'), 'Texte')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer en brouillon' }))
    await waitFor(() => expect(api.createJobOffer).toHaveBeenCalledWith(expect.anything(), false))
  })

  it('blocks saving without a title and a description', async () => {
    mountForm()
    await screen.findByLabelText('Titre')
    expect(screen.getByRole('button', { name: 'Enregistrer en brouillon' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enregistrer et publier' })).toBeDisabled()
  })

  it('hides the contract for a freelance gig', async () => {
    mountForm()
    await userEvent.selectOptions(await screen.findByLabelText('Type'), 'freelance')
    expect(screen.queryByLabelText('Contrat')).not.toBeInTheDocument()
  })

  it('loads and updates an existing offer', async () => {
    api.getMyOffer.mockResolvedValue(offer('o9', 'draft'))
    mountForm('/employeur/offres/o9')
    const title = await screen.findByDisplayValue('Offre o9')
    expect(screen.getByDisplayValue('React, SQL')).toBeInTheDocument()
    await userEvent.clear(title)
    await userEvent.type(title, 'Nouveau titre')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(api.updateJobOffer).toHaveBeenCalledWith('o9', expect.objectContaining({ title: 'Nouveau titre' })))
    expect(api.createJobOffer).not.toHaveBeenCalled()
  })

  it('shows a French message when the backend refuses', async () => {
    api.createJobOffer.mockRejectedValue(new Error('The closing day must be within the next year'))
    mountForm()
    await userEvent.type(await screen.findByLabelText('Titre'), 'Dev React')
    await userEvent.type(screen.getByLabelText('Description'), 'Texte')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer en brouillon' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('12 prochains mois')
  })
})

describe('Applicants', () => {
  it('lists applicants and filters by status', async () => {
    mountApplicants()
    expect(await screen.findByText('Candidat 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Retenue' }))
    await waitFor(() => expect(api.listOfferApplicants).toHaveBeenLastCalledWith('o1', 'shortlisted'))
  })

  it('shortlists the right applicant', async () => {
    mountApplicants()
    await userEvent.click(await screen.findByRole('button', { name: 'Retenir : Candidat 2' }))
    await waitFor(() => expect(api.setApplicationStatus).toHaveBeenCalledWith('a2', 'shortlisted'))
  })

  it('offers "seen" only for new applications', async () => {
    mountApplicants()
    await screen.findByText('Candidat 1')
    expect(screen.getByRole('button', { name: 'Marquer comme vue : Candidat 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marquer comme vue : Candidat 2' })).not.toBeInTheDocument()
  })

  it('shows the message and opens the CV', async () => {
    api.getApplicationDetail.mockResolvedValue({ message: 'Bonjour <b>vous</b>', cv_path: 'u1/a.pdf', cv_name: 'cv.pdf', summary: null })
    api.applicantCvLink.mockResolvedValue('https://signed.example/cv')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mountApplicants()
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le message et le CV : Candidat 1' }))
    expect(await screen.findByText('Bonjour <b>vous</b>')).toBeInTheDocument()
    expect(api.getApplicationDetail).toHaveBeenCalledWith('a1')
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir le CV' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/cv', '_blank', 'noopener,noreferrer'))
    expect(api.applicantCvLink).toHaveBeenCalledWith('u1/a.pdf')
    open.mockRestore()
  })

  it('writes to the right applicant', async () => {
    mountApplicants()
    const card = (await screen.findByText('Candidat 2')).closest('article') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: /Écrire un message/ }))
    await waitFor(() => expect(api.startConversation).toHaveBeenCalledWith('u2'))
    expect(await screen.findByText('conversation ouverte')).toBeInTheDocument()
  })

  it('shows a French message when a status change is refused', async () => {
    api.setApplicationStatus.mockRejectedValue(new Error('A status cannot go back'))
    mountApplicants()
    await userEvent.click(await screen.findByRole('button', { name: 'Refuser : Candidat 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('revenir en arrière')
  })
})
