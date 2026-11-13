// Optional monitoring. Both tools stay off until their setting exists, so the site works without them.
//   VITE_SENTRY_DSN       : error reports (Sentry). Loaded only when set.
//   VITE_PLAUSIBLE_DOMAIN : visit counts without cookies (Plausible). Loaded only when set.

/** Builds the Sentry "envelope" request for one error, or null when the DSN is not well formed. */
export function sentryRequest(dsn: string, message: string, kind: string, page: string): { url: string; body: string } | null {
  const m = /^https:\/\/([^@/]+)@([^/]+)\/(\d+)$/.exec(dsn)
  if (!m) return null
  const [, key, host, project] = m
  const eventId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`.replace(/\D/g, '').padEnd(32, '0')).replace(/-/g, '').slice(0, 32)
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    message: message.slice(0, 500),
    exception: { values: [{ type: kind, value: message.slice(0, 500) }] },
    request: { url: page },
  }
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')
  return { url: `https://${host}/api/${project}/envelope/?sentry_version=7&sentry_key=${key}`, body }
}

export function initMonitoring(): void {
  const env = import.meta.env as Record<string, string | undefined>
  const domain = env.VITE_PLAUSIBLE_DOMAIN
  if (domain) {
    const s = document.createElement('script')
    s.defer = true
    s.dataset.domain = domain
    s.src = 'https://plausible.io/js/script.js'
    document.head.appendChild(s)
  }
  const dsn = env.VITE_SENTRY_DSN
  if (dsn) {
    const send = (message: string, kind: string) => {
      try {
        const req = sentryRequest(dsn, message, kind, location.pathname)
        if (!req) { console.warn('[monitoring] the Sentry DSN is not well formed'); return }
        void fetch(req.url, { method: 'POST', body: req.body, keepalive: true })
          .then((r) => { if (!r.ok) console.warn('[monitoring] Sentry refused the report:', r.status) })
          .catch(() => console.warn('[monitoring] the report could not be sent (blocked by an extension or the network?)'))
      } catch { /* never break the page for a report */ }
    }
    window.addEventListener('error', (e) => send(e.message, 'Error'))
    window.addEventListener('unhandledrejection', (e) => send(String((e.reason && e.reason.message) || e.reason), 'UnhandledRejection'))
  }
}
