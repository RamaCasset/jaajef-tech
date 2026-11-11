import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Splash } from '../pages/Splash'
import { About } from '../pages/About'

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<Splash />} />
      <Route path="/a-propos" element={<About />} />
    </Routes>
  </MemoryRouter>,
)

describe('Splash and À propos', () => {
  it('shows the name, the tagline and the way in', () => {
    at('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('jaajef')
    expect(screen.getByText('La tech entre nous !')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "S'inscrire" })).toHaveAttribute('href', '/inscription')
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/connexion')
    expect(screen.getByRole('link', { name: 'À propos' })).toHaveAttribute('href', '/a-propos')
  })

  it('tells the story, shows the four tiles and offers to sign up', () => {
    at('/a-propos')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bienvenue sur jaajef.tech')
    expect(screen.getByText('Nos cultures dans notre tech !')).toBeInTheDocument()
    for (const text of ['Trouvez ou créez votre communauté.', 'Faites découvrir vos projets.', 'Challengez vous dans les quests.', 'Trouvez les bonnes opportunités.']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: "S'inscrire" })).toHaveAttribute('href', '/inscription')
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' })).toHaveAttribute('href', '/')
  })
})
