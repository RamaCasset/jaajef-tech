import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listBlogPosts: vi.fn(), likeBlogPost: vi.fn(), unlikeBlogPost: vi.fn(), getBlogPostBySlug: vi.fn(), getMyBlogPost: vi.fn(),
  listMyBlogPosts: vi.fn(), listBlogComments: vi.fn(), postBlogComment: vi.fn(), deleteBlogComment: vi.fn(), createBlogPost: vi.fn(),
  updateBlogPost: vi.fn(), publishBlogPost: vi.fn(), unpublishBlogPost: vi.fn(), deleteBlogPost: vi.fn(),
  uploadBlogImage: vi.fn(), removeBlogImage: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Blog } from '../pages/Blog'
import { BlogPost } from '../pages/BlogPost'
import { BlogEditor } from '../pages/BlogEditor'
import { BlogMine } from '../pages/BlogMine'

const card = (n: number, extra = {}) => ({
  id: `p${n}`, slug: `article-${n}`, title: `Article ${n}`, summary: `Résumé ${n}`, cover_url: null, tags: ['react'], author_id: 'u2',
  author_username: 'awa', published_at: '2026-11-01T00:00:00Z', like_count: 3, comment_count: 1, liked_by_me: false, ...extra,
})
const full = (extra = {}) => ({
  id: 'p1', slug: 'article-1', title: 'Article 1', summary: null, body: 'Ligne <b>un</b>\nLigne deux', cover_url: null, tags: ['react'],
  author_id: 'u2', author_username: 'awa', author_name: 'Awa Diallo', published_at: '2026-11-01T00:00:00Z', status: 'published',
  like_count: 3, comment_count: 1, liked_by_me: false, ...extra,
})

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listBlogPosts.mockResolvedValue([card(1), card(2, { liked_by_me: true, like_count: 5 })])
  api.getBlogPostBySlug.mockResolvedValue(full())
  api.listBlogComments.mockResolvedValue([
    { id: 1, author_id: 'me', body: 'Bravo', created_at: '2026-11-02T00:00:00Z', author_username: 'moussa' },
    { id: 2, author_id: 'u3', body: 'Merci', created_at: '2026-11-02T00:00:00Z', author_username: 'bass' },
  ])
  for (const f of [api.likeBlogPost, api.unlikeBlogPost, api.postBlogComment, api.deleteBlogComment, api.updateBlogPost, api.publishBlogPost, api.unpublishBlogPost, api.deleteBlogPost]) f.mockResolvedValue(undefined)
  api.createBlogPost.mockResolvedValue('new1')
})

describe('Blog feed', () => {
  const mount = () => render(<MemoryRouter><Blog /></MemoryRouter>)
  it('lists articles with links, counts, and my like state', async () => {
    mount()
    expect(await screen.findByRole('link', { name: 'Article 1' })).toHaveAttribute('href', '/blog/article-1')
    expect(screen.getByRole('button', { name: "Je n'aime plus : Article 2" })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/5 j'aime/)).toBeInTheDocument()
  })
  it('liking updates the count right away and calls the database; a failure puts it back', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: "J'aime : Article 1" }))
    expect(api.likeBlogPost).toHaveBeenCalledWith('p1')
    expect(await screen.findByText(/4 j'aime/)).toBeInTheDocument()
    api.unlikeBlogPost.mockRejectedValueOnce(new Error('boom'))
    await userEvent.click(screen.getByRole('button', { name: "Je n'aime plus : Article 2" }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/5 j'aime/)).toBeInTheDocument()
  })
  it('filters by theme after typing stops', async () => {
    mount()
    await screen.findByText('Article 1')
    await userEvent.type(screen.getByLabelText('Filtrer par thème'), 'react')
    await waitFor(() => expect(api.listBlogPosts).toHaveBeenLastCalledWith('react'))
  })
  it('empty and error states', async () => {
    api.listBlogPosts.mockResolvedValueOnce([])
    const first = mount()
    expect(await screen.findByText("Aucun article pour l'instant.")).toBeInTheDocument()
    first.unmount()
    api.listBlogPosts.mockRejectedValueOnce(new Error('x'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Article 1')).toBeInTheDocument()
  })
})

describe('Blog post', () => {
  const mount = () => render(
    <MemoryRouter initialEntries={['/blog/article-1']}>
      <Routes><Route path="/blog/:slug" element={<BlogPost />} /></Routes>
    </MemoryRouter>,
  )
  it('shows the text as plain text, never as html', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Article 1' })).toBeInTheDocument()
    expect(screen.getByText(/Ligne <b>un<\/b>/)).toBeInTheDocument()
    expect(document.querySelector('article b')).toBeNull()
  })
  it('formats titles, bold, lists, links and code', async () => {
    api.getBlogPostBySlug.mockResolvedValue(full({ body: '## Mon sous-titre\n\nUn mot **gras** et `code`.\n\n- un\n- deux\n\n[site](https://exemple.sn)' }))
    mount()
    expect(await screen.findByRole('heading', { name: 'Mon sous-titre', level: 2 })).toBeInTheDocument()
    expect(document.querySelector('article strong')?.textContent).toBe('gras')
    expect(document.querySelector('article code')?.textContent).toBe('code')
    expect(document.querySelectorAll('article li')).toHaveLength(2)
    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('href', 'https://exemple.sn')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
  it('drops dangerous links and images', async () => {
    api.getBlogPostBySlug.mockResolvedValue(full({ body: '[clic](javascript:alert(1))\n\n![pixel](https://spy.example/p.png)' }))
    mount()
    await screen.findByRole('heading', { name: 'Article 1' })
    expect(document.querySelector('article a')?.getAttribute('href') ?? '').not.toContain('javascript')
    expect(document.querySelector('article img')).toBeNull()
  })
  it('the author sees an edit link, other readers do not', async () => {
    const first = mount()
    await screen.findByRole('heading', { name: 'Article 1' })
    expect(screen.queryByRole('link', { name: 'Modifier' })).not.toBeInTheDocument()
    first.unmount()
    api.getBlogPostBySlug.mockResolvedValue(full({ author_id: 'me' }))
    mount()
    expect(await screen.findByRole('link', { name: 'Modifier' })).toHaveAttribute('href', '/blog/modifier/p1')
  })
  it('a draft shows a banner and no likes or comments', async () => {
    api.getBlogPostBySlug.mockResolvedValue(full({ author_id: 'me', status: 'draft', published_at: null }))
    mount()
    expect(await screen.findByRole('status')).toHaveTextContent('Brouillon')
    expect(screen.queryByText('Commentaires')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /J'aime/ })).not.toBeInTheDocument()
  })
  it('comments: send, and delete only my own (or any on my own article)', async () => {
    const first = mount()
    await screen.findByText('Bravo')
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(1)
    await userEvent.type(screen.getByLabelText('Votre commentaire'), 'Super')
    await userEvent.click(screen.getByRole('button', { name: 'Commenter' }))
    await waitFor(() => expect(api.postBlogComment).toHaveBeenCalledWith('p1', 'Super'))
    await waitFor(() => expect(screen.getByLabelText('Votre commentaire')).toHaveValue(''))
    first.unmount()
    api.getBlogPostBySlug.mockResolvedValue(full({ author_id: 'me' }))
    mount()
    await screen.findByText('Merci')
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(2)
  })
  it('the comment button stays off for a blank comment', async () => {
    mount()
    await screen.findByText('Bravo')
    await userEvent.type(screen.getByLabelText('Votre commentaire'), '  ')
    expect(screen.getByRole('button', { name: 'Commenter' })).toBeDisabled()
  })
  it('liking on the page changes the button and the count', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /♡ J'aime/ }))
    expect(api.likeBlogPost).toHaveBeenCalledWith('p1')
    expect(await screen.findByText(/4 j'aime/)).toBeInTheDocument()
  })
  it('unknown article', async () => {
    api.getBlogPostBySlug.mockResolvedValue(null)
    mount()
    expect(await screen.findByText(/n'existe pas ou n'est plus en ligne/)).toBeInTheDocument()
  })
})

describe('Blog editor', () => {
  const mount = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/blog/ecrire" element={<BlogEditor />} />
        <Route path="/blog/modifier/:id" element={<BlogEditor />} />
        <Route path="/blog/mes-articles" element={<p>my list</p>} />
      </Routes>
    </MemoryRouter>,
  )
  it('uploads a cover picture, shows it, saves its address, and tidies away a replaced one', async () => {
    api.uploadBlogImage.mockResolvedValueOnce('https://x.supabase.co/storage/v1/object/public/blog-images/me/a.png')
    api.uploadBlogImage.mockResolvedValueOnce('https://x.supabase.co/storage/v1/object/public/blog-images/me/b.png')
    api.removeBlogImage.mockResolvedValue(undefined)
    api.getMyBlogPost.mockResolvedValue(full({ id: 'new1' }))
    mount('/blog/ecrire')
    await userEvent.type(screen.getByLabelText('Titre'), 'Mon titre')
    await userEvent.type(screen.getByLabelText('Texte'), 'Du texte')
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Image de couverture (facultative)'), file)
    expect(await screen.findByRole('img', { name: "Aperçu de l'image de couverture" })).toHaveAttribute('src', expect.stringContaining('/me/a.png'))
    expect(api.uploadBlogImage).toHaveBeenCalledWith('me', file)
    await userEvent.upload(screen.getByLabelText('Image de couverture (facultative)'), new File(['y'], 'b.png', { type: 'image/png' }))
    await waitFor(() => expect(api.removeBlogImage).toHaveBeenCalledWith(expect.stringContaining('/me/a.png')))
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))
    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledWith(expect.objectContaining({ cover_url: expect.stringContaining('/me/b.png') }), false))
  })
  it('refuses a picture that is not allowed, with a clear message', async () => {
    api.uploadBlogImage.mockRejectedValueOnce(new Error('image-size'))
    mount('/blog/ecrire')
    await userEvent.upload(screen.getByLabelText('Image de couverture (facultative)'), new File(['x'], 'big.png', { type: 'image/png' }))
    expect(await screen.findByText(/trop lourde/)).toBeInTheDocument()
  })
  it('buttons stay off until there is a title and a text', async () => {
    mount('/blog/ecrire')
    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Titre'), 'Mon titre')
    expect(screen.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Texte'), 'Du texte')
    expect(screen.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeEnabled()
  })
  it('saves a new draft with clean tags, then opens it for editing', async () => {
    api.getMyBlogPost.mockResolvedValue(full({ id: 'new1', author_id: 'me' }))
    mount('/blog/ecrire')
    await userEvent.type(screen.getByLabelText('Titre'), 'Mon titre')
    await userEvent.type(screen.getByLabelText('Texte'), 'Du texte')
    await userEvent.type(screen.getByLabelText(/Thèmes/), 'react, , python ')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))
    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledWith({ title: 'Mon titre', summary: '', body: 'Du texte', cover_url: '', tags: ['react', 'python'] }, false))
    expect(await screen.findByRole('heading', { name: "Modifier l'article" })).toBeInTheDocument()
  })
  it('publishing a new article goes to my list', async () => {
    mount('/blog/ecrire')
    await userEvent.type(screen.getByLabelText('Titre'), 'Mon titre')
    await userEvent.type(screen.getByLabelText('Texte'), 'Du texte')
    await userEvent.click(screen.getByRole('button', { name: 'Publier' }))
    await waitFor(() => expect(api.createBlogPost).toHaveBeenCalledWith(expect.anything(), true))
    expect(await screen.findByText('my list')).toBeInTheDocument()
  })
  it('editing loads the article, saves changes, and publishes when asked', async () => {
    api.getMyBlogPost.mockResolvedValue(full({ id: 'p9', author_id: 'me', title: 'Ancien titre' }))
    mount('/blog/modifier/p9')
    const title = await screen.findByLabelText('Titre')
    expect(title).toHaveValue('Ancien titre')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Enregistré')
    expect(api.updateBlogPost).toHaveBeenCalledWith('p9', expect.objectContaining({ title: 'Ancien titre' }))
    expect(api.publishBlogPost).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Publier' }))
    await waitFor(() => expect(api.publishBlogPost).toHaveBeenCalledWith('p9'))
    expect(await screen.findByText('my list')).toBeInTheDocument()
  })
  it('shows server refusals in French and stays', async () => {
    api.createBlogPost.mockRejectedValue(new Error('You are publishing too fast, try again later'))
    mount('/blog/ecrire')
    await userEvent.type(screen.getByLabelText('Titre'), 'Mon titre')
    await userEvent.type(screen.getByLabelText('Texte'), 'Du texte')
    await userEvent.click(screen.getByRole('button', { name: 'Publier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('trop vite')
    expect(screen.queryByText('my list')).not.toBeInTheDocument()
  })
  it('an unknown article to edit says so', async () => {
    api.getMyBlogPost.mockResolvedValue(null)
    mount('/blog/modifier/zzz')
    expect(await screen.findByText("Cet article n'existe pas.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Titre')).not.toBeInTheDocument()
  })
})

describe('My articles', () => {
  const mount = () => render(<MemoryRouter><BlogMine /></MemoryRouter>)
  const mine = [
    { id: 'a', slug: 'a', title: 'Brouillon A', status: 'draft', staff_hidden: false, updated_at: '2026-11-01' },
    { id: 'b', slug: 'b', title: 'Publié B', status: 'published', staff_hidden: true, updated_at: '2026-11-01' },
  ]
  beforeEach(() => api.listMyBlogPosts.mockResolvedValue(mine))
  it('shows the state of each, and the right button for it', async () => {
    mount()
    expect(await screen.findByText('Brouillon A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publier : Brouillon A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repasser en brouillon : Publié B' })).toBeInTheDocument()
    expect(screen.getByText(/Masqué par l'équipe/)).toBeInTheDocument()
  })
  it('publish and unpublish call the database', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Publier : Brouillon A' }))
    expect(api.publishBlogPost).toHaveBeenCalledWith('a')
    await userEvent.click(screen.getByRole('button', { name: 'Repasser en brouillon : Publié B' }))
    expect(api.unpublishBlogPost).toHaveBeenCalledWith('b')
  })
  it('delete asks first; saying nothing deletes nothing', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer : Brouillon A' }))
    expect(api.deleteBlogPost).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Oui, supprimer' }))
    expect(api.deleteBlogPost).toHaveBeenCalledWith('a')
  })
  it('empty state', async () => {
    api.listMyBlogPosts.mockResolvedValue([])
    mount()
    expect(await screen.findByText(/n'avez encore rien écrit/)).toBeInTheDocument()
  })
})
