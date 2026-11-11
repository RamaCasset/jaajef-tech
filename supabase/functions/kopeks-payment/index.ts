// jaajef.tech - Buying Kopeks with PayDunya (Supabase Edge Function)
//
// One function, three jobs:
//   create   a signed-in member sends { action: 'create', kopeks, method, phone? }. A purchase is recorded, a PayDunya
//            payment page is opened for the exact price worked out by the database, and its address is sent back.
//   confirm  the member comes back from the payment page and sends { action: 'confirm', token }. The function asks
//            PayDunya for the real status of that payment and records it.
//   ipn      PayDunya itself calls this address (a form POST) when a payment changes. Same check as "confirm".
//
// Nothing the browser or the IPN body says is believed: the status and the amount ALWAYS come from asking PayDunya
// directly with our private keys. Kopeks are credited by the database, once per purchase.
//
// Secrets: PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN, PAYDUNYA_MODE ("test" or "live", default "test"),
// SITE_URL (the website address, no slash at the end).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEYS) are provided by Supabase itself.
// Deploy WITHOUT the sign-in check on the door, because PayDunya is not a member: --no-verify-jwt. The function checks
// the sign-in itself for create and confirm.

type Env = {
  supabaseUrl: string; serviceKey: string
  masterKey: string; privateKey: string; paydunyaToken: string
  mode: 'test' | 'live'; siteUrl: string; baseUrl?: string
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// PayDunya's names for the payment channels. Check them in the test mode if a method does not show up.
const CHANNELS: Record<string, string> = { wave: 'wave-senegal', orange: 'orange-money-senegal', card: 'card' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

function firstSecretKey(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return String(parsed[0] ?? '')
    return String(Object.values(parsed)[0] ?? '')
  } catch { return '' }
}

function dbHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: env.serviceKey }
  if (!env.serviceKey.startsWith('sb_')) headers.authorization = `Bearer ${env.serviceKey}`
  return headers
}

async function whoIs(token: string, env: Env, fetchFn: typeof fetch): Promise<string | null> {
  const response = await fetchFn(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.serviceKey, authorization: `Bearer ${token}` } })
  if (!response.ok) return null
  const user = await response.json()
  return typeof user?.id === 'string' ? user.id : null
}

async function rpc(name: string, args: Record<string, unknown>, env: Env, fetchFn: typeof fetch): Promise<{ ok: boolean; body: any }> {
  const response = await fetchFn(`${env.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: dbHeaders(env), body: JSON.stringify(args) })
  let body: any = null
  try { body = await response.json() } catch { body = null }
  return { ok: response.ok, body }
}

function paydunyaBase(env: Env): string {
  if (env.baseUrl) return env.baseUrl
  return env.mode === 'live' ? 'https://app.paydunya.com/api/v1' : 'https://app.paydunya.com/sandbox-api/v1'
}

function paydunyaHeaders(env: Env): Record<string, string> {
  return {
    'content-type': 'application/json',
    'PAYDUNYA-MASTER-KEY': env.masterKey,
    'PAYDUNYA-PRIVATE-KEY': env.privateKey,
    'PAYDUNYA-TOKEN': env.paydunyaToken,
  }
}

/** Asks PayDunya what really happened to this payment, then tells the database. */
export async function settle(token: string, env: Env, fetchFn: typeof fetch): Promise<{ outcome: string; kopeks?: number }> {
  let confirmed: any
  try {
    const response = await fetchFn(`${paydunyaBase(env)}/checkout-invoice/confirm/${encodeURIComponent(token)}`, { headers: paydunyaHeaders(env) })
    confirmed = await response.json()
  } catch { return { outcome: 'unavailable' } }
  if (!confirmed || confirmed.response_code !== '00') return { outcome: 'unknown' }
  const status = String(confirmed.status ?? '')
  const paid = Math.round(Number(confirmed.invoice?.total_amount))
  const result = await rpc('complete_kopek_purchase', { p_token: token, p_status: status, p_paid_cfa: Number.isFinite(paid) ? paid : null }, env, fetchFn)
  if (!result.ok || typeof result.body !== 'string') return { outcome: 'unavailable' }
  return { outcome: result.body }
}

async function createPayment(userId: string, payload: any, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const kopeks = Number(payload?.kopeks)
  const method = String(payload?.method ?? '')
  if (!Number.isInteger(kopeks) || !CHANNELS[method]) return jsonResponse({ error: 'bad_request' }, 400)
  const phone = String(payload?.phone ?? '').replace(/\D/g, '').slice(-9)

  const made = await rpc('create_kopek_purchase', { p_user: userId, p_kopeks: kopeks, p_method: method }, env, fetchFn)
  if (!made.ok) {
    const message = String(made.body?.message ?? '').toLowerCase()
    if (message.includes('unknown pack') || message.includes('unknown method')) return jsonResponse({ error: 'bad_request' }, 400)
    return jsonResponse({ error: 'database_error' }, 502)
  }
  const row = Array.isArray(made.body) ? made.body[0] : made.body
  const purchaseId = String(row?.purchase_id ?? '')
  const amount = Number(row?.amount_cfa)
  if (!purchaseId || !Number.isFinite(amount)) return jsonResponse({ error: 'database_error' }, 502)

  let invoice: any
  try {
    const response = await fetchFn(`${paydunyaBase(env)}/checkout-invoice/create`, {
      method: 'POST',
      headers: paydunyaHeaders(env),
      body: JSON.stringify({
        invoice: {
          total_amount: amount,
          description: `${kopeks} Kopeks jaajef.tech`,
          channels: [CHANNELS[method]],
          ...(phone.length === 9 ? { customer: { phone } } : {}),
        },
        store: { name: 'jaajef.tech', website_url: env.siteUrl },
        custom_data: { purchase_id: purchaseId },
        actions: {
          cancel_url: `${env.siteUrl}/kopeks`,
          return_url: `${env.siteUrl}/kopeks/retour`,
          callback_url: `${env.supabaseUrl}/functions/v1/kopeks-payment`,
        },
      }),
    })
    invoice = await response.json()
  } catch { invoice = null }

  if (!invoice || invoice.response_code !== '00' || typeof invoice.token !== 'string' || typeof invoice.response_text !== 'string') {
    return jsonResponse({ error: 'payment_unavailable' }, 502)
  }
  await rpc('set_kopek_purchase_token', { p_purchase: purchaseId, p_token: invoice.token }, env, fetchFn)
  return jsonResponse({ url: invoice.response_text })
}

async function confirmPayment(userId: string, payload: any, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const token = String(payload?.token ?? '')
  if (!token || token.length > 100) return jsonResponse({ error: 'bad_request' }, 400)
  // Only the member who made this purchase may ask about it.
  const query = `${env.supabaseUrl}/rest/v1/kopek_purchases?select=kopeks,status&provider_token=eq.${encodeURIComponent(token)}&user_id=eq.${encodeURIComponent(userId)}`
  const response = await fetchFn(query, { headers: dbHeaders(env) })
  const rows = response.ok ? await response.json() : null
  if (!Array.isArray(rows) || rows.length === 0) return jsonResponse({ error: 'not_found' }, 404)
  const settled = await settle(token, env, fetchFn)
  return jsonResponse({ outcome: settled.outcome, kopeks: Number(rows[0].kopeks) })
}

async function ipn(request: Request, env: Env, fetchFn: typeof fetch): Promise<Response> {
  let token = ''
  try {
    const type = request.headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      const body = await request.json()
      token = String(body?.data?.invoice?.token ?? body?.invoice?.token ?? '')
    } else {
      const form = await request.formData()
      token = String(form.get('data[invoice][token]') ?? '')
    }
  } catch { return jsonResponse({ error: 'bad_request' }, 400) }
  if (!token) return jsonResponse({ error: 'bad_request' }, 400)
  await settle(token, env, fetchFn)
  return jsonResponse({ ok: true })
}

export async function handler(request: Request, getEnv: (name: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  const env: Env = {
    supabaseUrl: getEnv('SUPABASE_URL') ?? '',
    serviceKey: getEnv('SUPABASE_SERVICE_ROLE_KEY') || firstSecretKey(getEnv('SUPABASE_SECRET_KEYS')) || '',
    masterKey: getEnv('PAYDUNYA_MASTER_KEY') ?? '',
    privateKey: getEnv('PAYDUNYA_PRIVATE_KEY') ?? '',
    paydunyaToken: getEnv('PAYDUNYA_TOKEN') ?? '',
    mode: getEnv('PAYDUNYA_MODE') === 'live' ? 'live' : 'test',
    siteUrl: (getEnv('SITE_URL') ?? '').replace(/\/+$/, ''),
    baseUrl: getEnv('PAYDUNYA_BASE_URL') || undefined, // for tests only
  }
  // Say WHICH settings are missing (names only, never values), so the setup can be fixed without guessing.
  const missing = [
    ['SUPABASE_URL', env.supabaseUrl], ['SUPABASE_SERVICE_ROLE_KEY', env.serviceKey], ['PAYDUNYA_MASTER_KEY', env.masterKey],
    ['PAYDUNYA_PRIVATE_KEY', env.privateKey], ['PAYDUNYA_TOKEN', env.paydunyaToken], ['SITE_URL', env.siteUrl],
  ].filter(([, value]) => !value).map(([name]) => name)
  if (missing.length > 0) return jsonResponse({ error: 'not_configured', missing }, 503)

  const type = request.headers.get('content-type') ?? ''
  const auth = request.headers.get('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''

  // A form post is PayDunya calling. It is safe to accept: the payment is always checked with PayDunya itself.
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) return ipn(request, env, fetchFn)

  const userId = bearer ? await whoIs(bearer, env, fetchFn) : null
  if (!userId) return jsonResponse({ error: 'sign_in_required' }, 401)
  let payload: any
  try { payload = await request.json() } catch { return jsonResponse({ error: 'bad_request' }, 400) }
  if (payload?.action === 'create') return createPayment(userId, payload, env, fetchFn)
  if (payload?.action === 'confirm') return confirmPayment(userId, payload, env, fetchFn)
  return jsonResponse({ error: 'bad_request' }, 400)
}

const deno = (globalThis as any).Deno
if (deno && typeof deno.serve === 'function') {
  deno.serve((request: Request) => handler(request, (name) => deno.env.get(name)))
}
