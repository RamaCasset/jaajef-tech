import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MentionText } from '../components/MentionText'
import { bucketOf, matchesFilter, noticeLink, noticeText, noticeTitle, tileOf } from '../lib/notificationMeta'
import type { NotificationRow } from '../lib/api'

const note = (kind: NotificationRow['kind'], data: Record<string, unknown> = {}, read_at: string | null = null): NotificationRow => ({ id: 1, kind, data, created_at: '2026-11-09T12:00:00Z', read_at })

describe('MentionText', () => {
  it('turns each @name into a link to that profile and leaves the rest as plain text', () => {
    render(<MemoryRouter><MentionText text={'Bravo @Awa_Diallo et @fatou_n ! mail ana@exemple.sn <b>pas du html</b>'} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '@Awa_Diallo' })).toHaveAttribute('href', '/profil/awa_diallo')
    expect(screen.getByRole('link', { name: '@fatou_n' })).toHaveAttribute('href', '/profil/fatou_n')
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByText(/<b>pas du html<\/b>/)).toBeInTheDocument()
  })

  it('does not link names that are too short', () => {
    render(<MemoryRouter><MentionText text="salut @ab" /></MemoryRouter>)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('notice kinds that the database sends', () => {
  it('every kind has a title, a sentence, and a filter', () => {
    const kinds: NotificationRow['kind'][] = ['mention', 'quest_completed', 'blog_comment', 'blog_like', 'new_application', 'job_alert', 'souk_sale', 'souk_item_removed', 'blog_hidden']
    for (const k of kinds) {
      expect(noticeTitle(note(k)).length).toBeGreaterThan(2)
      expect(noticeText(note(k, { actor_username: 'awa', post_title: 'T' }))).not.toBe(k)
    }
  })

  it('a mention says who, where and the first words, and leads to the place', () => {
    const blog = note('mention', { place: 'blog', post_title: 'Rust', post_slug: 'rust', actor_username: 'awa', excerpt: 'Regarde' })
    expect(noticeText(blog)).toBe('awa vous a mentionné dans un commentaire sur « Rust » : Regarde')
    expect(noticeLink(blog)).toBe('/blog/rust')
    expect(noticeLink(note('mention', { place: 'project', project_id: 'p1' }))).toBe('/projets/p1')
    expect(tileOf('mention').text).toBe('@')
  })

  it('a solved quest says what it paid and leads to the quest', () => {
    const q = note('quest_completed', { quest_title: 'Boucles', quest_slug: 'boucles', xp: 100, kopeks: 10 })
    expect(noticeText(q)).toBe('Vous avez réussi « Boucles » : +100 XP et 10 Kopeks.')
    expect(noticeLink(q)).toBe('/quetes/boucles')
  })

  it('mentions and comments are under Mentions, quests under Quêtes, jobs only under Toutes', () => {
    expect(matchesFilter(note('mention'), 'mentions')).toBe(true)
    expect(matchesFilter(note('blog_comment'), 'mentions')).toBe(true)
    expect(matchesFilter(note('quest_completed'), 'quests')).toBe(true)
    expect(matchesFilter(note('new_application'), 'projects')).toBe(false)
    expect(matchesFilter(note('new_application'), 'all')).toBe(true)
    expect(matchesFilter(note('mention', {}, '2026-11-09T13:00:00Z'), 'unread')).toBe(false)
  })

  it('puts a notice in today, yesterday, this week or earlier', () => {
    const now = new Date('2026-11-09T18:00:00')
    expect(bucketOf('2026-11-09T09:00:00', now)).toBe('today')
    expect(bucketOf('2026-11-08T23:00:00', now)).toBe('yesterday')
    expect(bucketOf('2026-11-05T10:00:00', now)).toBe('week')
    expect(bucketOf('2026-10-01T10:00:00', now)).toBe('older')
  })
})
