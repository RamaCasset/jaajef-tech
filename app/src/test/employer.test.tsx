import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getMyEmployer: vi.fn(), setMyCompanyName: vi.fn(),
  listMyOffers: vi.fn(), getMyOffer: vi.fn(), createJobOffer: vi.fn(), updateJobOffer: vi.fn(),
  publishJobOffer: vi.fn(), closeJobOffer: vi.fn(), unpublishJobOffer: vi.fn(), deleteJobOffer: vi.fn(),
  listOfferApplicants: vi.fn(), setApplicationStatus: vi.fn(), getApplicationDetail: vi.fn(),
  applicantCvLink: vi.fn(), startConversation: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa', username: 'moussa' } }, signOut: vi.fn() }),
}))

import { MyOffers } from '../components/MyOffers'
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
const mountHub = () => render(<MemoryRouter><MyOffers userId="me" own /></MemoryRouter>)
const mountForm = (path = '/jobs/nouvelle') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/jobs/nouvelle" element={<OfferForm />} />
      <Route path="/jobs/:id/modifier" element={<OfferForm />} />
      <Route path="/profil/:username" element={<p>hub</p>} />
    </Routes>
  </MemoryRouter>,
)
const applicant = (n: number, status = 'submitted') => ({
  id: `a${n}`, applicant_id: `u${n}`, username: `m${n}`, display_name: `Candidat ${n}`, avatar_url: null, headline: `Dev ${n}`,
  skills: ['React'], status, applied_at: '2026-11-01T00:00:00Z', has_cv: true,
})
const mountApplicants = () => render(
  <MemoryRouter initialEntries={['/jobs/o1/candidatures']}>
    <Routes>
      <Route path="/jobs/:id/candidatures" element={<OfferApplicants />} />
      <Route path="/messages/:id" element={<p>conversation ouverte</p>} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  api.getMyEmployer.mockResolvedValue(emp())
  api.listMyOffers.mockResolvedValue([])
  for (const k of ['setMyCompanyName', 'createJobOffer', 'updateJobOffer', 'closeJobOffer', 'unpublishJobOffer', 'deleteJobOffer', 'setApplicationStatus'] as const) api[k].mockResolvedValue(undefined)
  api.publishJobOffer.mockResolvedValue('published')
  api.listOfferApplicants.mockResolvedValue([applicant(1), applicant(2, 'seen')])
  api.startConversation.mockResolvedValue('c1')
})

describe('My offers', () => {
  it('publishes a draft', async () => {
    api.listMyOffers.mockResolvedValue([offer('o1', 'draft')])
    mountHub()
    await userEvent.click(await screen.findByRole('button', { name: 'Publier : Offre o1' }))
    await waitFor(() => expect(api.publishJobOffer).toHaveBeenCalledWith('o1'))
    expect(await screen.findByText('Offre publiée.')).toBeInTheDocument()
  })

  it('shows only published offers on someone else\'s profile, without actions', async () => {
    api.listMyOffers.mockResolvedValue([offer('d', 'draft'), offer('p', 'published')])
    render(<MemoryRouter><MyOffers userId="other" own={false} /></MemoryRouter>)
    expect(await screen.findByText('Offre p')).toBeInTheDocument()
    expect(screen.queryByText('Offre d')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
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

  it('saves a new company name before the offer', async () => {
    mountForm()
    const company = await screen.findByLabelText("Nom de l'entreprise (facultatif)")
    await userEvent.clear(company)
    await userEvent.type(company, 'Teranga Tech')
    await userEvent.type(screen.getByLabelText('Titre'), 'Dev React')
    await userEvent.type(screen.getByLabelText('Description'), 'Texte')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer et publier' }))
    await waitFor(() => expect(api.setMyCompanyName).toHaveBeenCalledWith('Teranga Tech'))
    expect(api.createJobOffer).toHaveBeenCalled()
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
    mountForm('/jobs/o9/modifier')
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
