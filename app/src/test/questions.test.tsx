import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listQuestions: vi.fn(), getQuestion: vi.fn(), listAnswers: vi.fn(), askQuestion: vi.fn(), deleteQuestion: vi.fn(), postAnswer: vi.fn(),
  deleteAnswer: vi.fn(), editQuestion: vi.fn(), editAnswer: vi.fn(), acceptAnswer: vi.fn(), unacceptAnswer: vi.fn(), voteQuestion: vi.fn(), voteAnswer: vi.fn(),
  getMyStaffAccess: vi.fn(), unreadNotificationCount: vi.fn(), listMyCommunities: vi.fn(),
}))
vi.mock('../lib/api', () => api)
const auth = vi.hoisted(() => ({ id: 'me' }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: auth.id, username: 'moi', display_name: 'Moi' } }, signOut: vi.fn() }),
}))

import { Questions } from '../pages/Questions'
import { AskQuestion } from '../pages/AskQuestion'
import { QuestionPage } from '../pages/QuestionPage'

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p> }
const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/questions" element={<><Questions /><Where /></>} />
      <Route path="/questions/poser" element={<><AskQuestion /><Where /></>} />
      <Route path="/questions/:id" element={<><QuestionPage /><Where /></>} />
    </Routes>
  </MemoryRouter>,
)

const card = (extra = {}) => ({ id: 'q1', title: 'Comment lire du JSON ?', tags: ['python', 'json'], author_id: 'u2', author_username: 'awa', answer_count: 2, vote_count: 3, solved: false, created_at: '2026-11-08T10:00:00Z', community_id: null, community_slug: null, community_name: null, ...extra })
const full = (extra = {}) => ({ ...card(), body: 'Je veux lire **data.json**', author_display_name: 'Awa', accepted_answer_id: null, voted_by_me: false, edited_at: null, ...extra })
const answer = (extra = {}) => ({ id: 7, body: 'Utilise `json.load`', author_id: 'u3', author_username: 'bass', author_display_name: 'Bass', vote_count: 1, voted_by_me: false, accepted: false, created_at: '2026-11-08T11:00:00Z', edited_at: null, ...extra })

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  auth.id = 'me'
  api.listMyCommunities.mockResolvedValue([{ id: 'c1', slug: 'gamedev', name: 'GameDev Senegal', role: 'member' }, { id: 'c2', slug: 'ai-lab', name: 'AI Lab', role: 'member' }])
  api.getMyStaffAccess.mockResolvedValue({ role: null, shopManager: false, shopOwner: false, questWriter: false })
  api.unreadNotificationCount.mockResolvedValue(0)
  api.listQuestions.mockResolvedValue([card(), card({ id: 'q2', title: 'Pourquoi ce bug apparaît ?', solved: true })])
  api.getQuestion.mockResolvedValue(full())
  api.listAnswers.mockResolvedValue([answer()])
})

describe('Questions list', () => {
  it('lists questions with their counts and a solved mark', async () => {
    mount('/questions')
    expect(await screen.findByRole('link', { name: 'Comment lire du JSON ?' })).toHaveAttribute('href', '/questions/q1')
    expect(screen.getAllByLabelText('2 réponses').length).toBeGreaterThan(0)
    expect(screen.getByText('Résolue')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Poser une question' })[0]).toHaveAttribute('href', '/questions/poser')
  })

  it('asks again with the chosen filter and sort', async () => {
    mount('/questions')
    await screen.findByRole('link', { name: 'Comment lire du JSON ?' })
    await userEvent.click(screen.getByRole('button', { name: 'Sans solution' }))
    await waitFor(() => expect(api.listQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'open', sort: 'recent' })))
    await userEvent.selectOptions(screen.getByLabelText('Trier par'), 'useful')
    await waitFor(() => expect(api.listQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'open', sort: 'useful' })))
  })

  it('a click on a tag filters by it', async () => {
    mount('/questions')
    await userEvent.click((await screen.findAllByRole('button', { name: 'json' }))[0])
    await waitFor(() => expect(api.listQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'json' })))
  })

  it('says so when there is nothing, and when loading fails', async () => {
    api.listQuestions.mockResolvedValueOnce([])
    mount('/questions')
    expect(await screen.findByText(/Soyez la première personne/)).toBeInTheDocument()
  })

  it('shows a retry button when loading fails', async () => {
    api.listQuestions.mockRejectedValueOnce(new Error('down'))
    mount('/questions')
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger')
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('link', { name: 'Comment lire du JSON ?' })).toBeInTheDocument()
  })
})

describe('Ask a question', () => {
  it('sends the title, text and cleaned tags, then opens the question', async () => {
    api.askQuestion.mockResolvedValue('q9')
    mount('/questions/poser')
    await userEvent.type(screen.getByLabelText('Titre de la question'), 'Comment lire du JSON ?')
    await userEvent.type(screen.getByLabelText('Détails'), 'Je veux lire un fichier.')
    await userEvent.type(screen.getByLabelText(/Étiquettes/), 'python, json , ')
    await userEvent.click(screen.getByRole('button', { name: 'Publier la question' }))
    await waitFor(() => expect(api.askQuestion).toHaveBeenCalledWith('Comment lire du JSON ?', 'Je veux lire un fichier.', ['python', 'json'], null))
    expect(await screen.findByTestId('where')).toHaveTextContent('/questions/q9')
  })

  it('offers the whole City or one of my communities, and starts on the community it was opened from', async () => {
    api.askQuestion.mockResolvedValue('q9')
    mount('/questions/poser?communaute=gamedev')
    const where = screen.getByLabelText('Où publier la question ?') as HTMLSelectElement
    await waitFor(() => expect(where).toHaveValue('c1'))
    expect(screen.getByRole('option', { name: 'Toute la Cité (visible par tous)' })).toBeInTheDocument()
    await userEvent.selectOptions(where, 'c2')
    await userEvent.type(screen.getByLabelText('Titre de la question'), 'Comment lire du JSON ?')
    await userEvent.type(screen.getByLabelText('Détails'), 'Je veux lire un fichier.')
    await userEvent.click(screen.getByRole('button', { name: 'Publier la question' }))
    await waitFor(() => expect(api.askQuestion).toHaveBeenCalledWith('Comment lire du JSON ?', 'Je veux lire un fichier.', [], 'c2'))
  })

  it('cannot be sent empty, and shows a refusal in French', async () => {
    api.askQuestion.mockRejectedValue(new Error('The title needs at least 10 characters'))
    mount('/questions/poser')
    expect(screen.getByRole('button', { name: 'Publier la question' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Titre de la question'), 'court')
    await userEvent.type(screen.getByLabelText('Détails'), 'texte')
    await userEvent.click(screen.getByRole('button', { name: 'Publier la question' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 10 et 150')
  })
})

describe('A question', () => {
  it('shows the question, its answers, and lets someone else vote and answer', async () => {
    api.postAnswer.mockResolvedValue(8)
    api.voteQuestion.mockResolvedValue(undefined)
    mount('/questions/q1')
    expect(await screen.findByRole('heading', { name: 'Comment lire du JSON ?' })).toBeInTheDocument()
    expect(screen.getByText('data.json').tagName).toBe('STRONG')
    expect(screen.getByText('json.load').tagName).toBe('CODE')
    expect(screen.queryByRole('button', { name: 'Choisir comme solution' })).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: /^Utile/ })[0])
    expect(api.voteQuestion).toHaveBeenCalledWith('q1', true)
    await userEvent.type(screen.getByLabelText('Votre réponse'), 'Merci de ta question')
    await userEvent.click(screen.getByRole('button', { name: 'Publier la réponse' }))
    await waitFor(() => expect(api.postAnswer).toHaveBeenCalledWith('q1', 'Merci de ta question'))
  })

  it('the asker chooses the solution, and can remove it', async () => {
    auth.id = 'u2'
    api.acceptAnswer.mockImplementation(async () => { api.listAnswers.mockResolvedValue([answer({ accepted: true })]) })
    mount('/questions/q1')
    await userEvent.click(await screen.findByRole('button', { name: 'Choisir comme solution' }))
    expect(api.acceptAnswer).toHaveBeenCalledWith(7)
    api.unacceptAnswer.mockResolvedValue(undefined)
    await userEvent.click(await screen.findByRole('button', { name: 'Retirer la solution' }))
    expect(api.unacceptAnswer).toHaveBeenCalledWith('q1')
  })

  it('shows the solution first with its mark, and no vote on my own answer', async () => {
    auth.id = 'u3'
    api.listAnswers.mockResolvedValue([answer({ accepted: true })])
    mount('/questions/q1')
    expect(await screen.findByText('Solution')).toBeInTheDocument()
    const mine = screen.getByRole('button', { name: 'Supprimer ma réponse' })
    expect(mine).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Utile \(1\)/ })).toBeNull()
  })

  it('the asker can delete the question after confirming', async () => {
    auth.id = 'u2'
    api.deleteQuestion.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mount('/questions/q1')
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer ma question' }))
    await waitFor(() => expect(api.deleteQuestion).toHaveBeenCalledWith('q1'))
    expect(await screen.findByTestId('where')).toHaveTextContent('/questions')
  })

  it('says so when the question is gone', async () => {
    api.getQuestion.mockResolvedValue(null)
    mount('/questions/zzz')
    expect(await screen.findByRole('alert')).toHaveTextContent("n'existe pas")
  })

  it('shows refusals in French', async () => {
    api.voteQuestion.mockRejectedValue(new Error('You cannot vote for your own question'))
    mount('/questions/q1')
    await userEvent.click((await screen.findAllByRole('button', { name: /^Utile/ }))[0])
    expect(await screen.findByRole('alert')).toHaveTextContent('votre propre message')
  })

  it('the asker edits the question', async () => {
    auth.id = 'u2'
    api.editQuestion.mockResolvedValue(undefined)
    mount('/questions/q1')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Modifier' }))[0])
    const title = screen.getByLabelText('Titre de la question')
    await userEvent.clear(title)
    await userEvent.type(title, 'Lire un JSON proprement')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(api.editQuestion).toHaveBeenCalledWith('q1', 'Lire un JSON proprement', 'Je veux lire **data.json**', ['python', 'json']))
  })

  it('an author edits their own answer, and others see no edit button', async () => {
    auth.id = 'u3'
    api.editAnswer.mockResolvedValue(undefined)
    mount('/questions/q1')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }))
    const box = screen.getByRole('textbox', { name: 'Modifier ma réponse' })
    await userEvent.clear(box)
    await userEvent.type(box, 'Version corrigée')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(api.editAnswer).toHaveBeenCalledWith(7, 'Version corrigée'))
  })

  it('a visitor sees no edit button', async () => {
    mount('/questions/q1')
    await screen.findByRole('heading', { name: 'Comment lire du JSON ?' })
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
  })
})

describe('A question of a community', () => {
  it('says which community it is in and goes back there', async () => {
    api.getQuestion.mockResolvedValue(full({ community_id: 'c1', community_slug: 'gamedev', community_name: 'GameDev Senegal' }))
    mount('/questions/q1')
    expect(await screen.findByText('Dans GameDev Senegal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Retour à GameDev Senegal/ })).toHaveAttribute('href', '/communautes/gamedev')
  })

  it('on the big list, shows the community name as a link', async () => {
    api.listQuestions.mockResolvedValue([card({ community_id: 'c1', community_slug: 'gamedev', community_name: 'GameDev Senegal' })])
    mount('/questions')
    expect(await screen.findByRole('link', { name: 'GameDev Senegal' })).toHaveAttribute('href', '/communautes/gamedev')
  })
})
