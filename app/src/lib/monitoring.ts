// Optional monitoring. Both tools stay off until their setting exists, so the site works without them.
//   VITE_SENTRY_DSN       : error reports (Sentry). Loaded only when set.
//   VITE_PLAUSIBLE_DOMAIN : visit counts without cookies (Plausible). Loaded only when set.
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
    const send = (payload: Record<string, unknown>) => {
      try {
        const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn)
        if (!m) return
        const [, key, host, project] = m
        void fetch(`https://${host}/api/${project}/store/?sentry_version=7&sentry_key=${key}`, {
          method: 'POST',
          body: JSON.stringify({ platform: 'javascript', level: 'error', timestamp: Date.now() / 1000, request: { url: location.pathname }, ...payload }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* never break the page for a report */ }
    }
    window.addEventListener('error', (e) => send({ message: e.message, exception: { values: [{ type: 'Error', value: e.message }] } }))
    window.addEventListener('unhandledrejection', (e) => send({ message: String((e.reason && e.reason.message) || e.reason), exception: { values: [{ type: 'UnhandledRejection', value: String(e.reason) }] } }))
  }
}
