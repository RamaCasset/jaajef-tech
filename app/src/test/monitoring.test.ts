import { describe, expect, it } from 'vitest'
import { sentryRequest } from '../lib/monitoring'

describe('Sentry report', () => {
  it('builds an envelope request from a DSN', () => {
    const r = sentryRequest('https://abc123@o1.ingest.sentry.io/42', 'boom', 'Error', '/quetes')!
    expect(r.url).toBe('https://o1.ingest.sentry.io/api/42/envelope/?sentry_version=7&sentry_key=abc123')
    const [header, item, event] = r.body.split('\n').map((l) => JSON.parse(l))
    expect(item).toEqual({ type: 'event' })
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(event.event_id).toBe(header.event_id)
    expect(event.exception.values[0]).toEqual({ type: 'Error', value: 'boom' })
    expect(event.request.url).toBe('/quetes')
  })
  it('accepts a regional host and refuses a badly formed DSN', () => {
    expect(sentryRequest('https://k@o9.ingest.de.sentry.io/7', 'x', 'Error', '/')?.url).toContain('o9.ingest.de.sentry.io/api/7/')
    expect(sentryRequest('not a dsn', 'x', 'Error', '/')).toBeNull()
    expect(sentryRequest('http://k@host/1', 'x', 'Error', '/')).toBeNull()
  })
})
