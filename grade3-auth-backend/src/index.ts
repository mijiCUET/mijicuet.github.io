import { Hono } from 'hono'

type Bindings = {
  FRONTEND_ORIGIN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  SESSION_SECRET: string
  DATA_ENCRYPTION_KEY: string
  GITHUB_TOKEN?: string
  GITHUB_APP_ID?: string
  GITHUB_INSTALLATION_ID?: string
  GITHUB_PRIVATE_KEY?: string
  AUTH_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> }
}

type TopicStat = { attempted: number; correct: number }
type UserRecord = {
  schemaVersion: 1
  username: string
  createdAt: string
  auth: { salt: string; iterations: number; hash: string }
  security: { question: string; salt: string; iterations: number; answerHash: string }
  totp: { iv: string; ciphertext: string }
  progress: {
    highestUnlocked: number
    attempted: number
    correct: number
    sessions: number
    topics: Record<string, TopicStat>
    updatedAt: string
  }
}

type GithubFile = { content: string; sha: string }

const app = new Hono<{ Bindings: Bindings }>()
const enc = new TextEncoder()
const dec = new TextDecoder()
const USER_RE = /^[A-Z][a-z][0-9]{2}[A-Za-z]{2}$/
const PASS_RE = /^(?=.{10,128}$)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])[^\s]+$/
const API_VERSION = '2026-03-10'
let appTokenCache: { token: string; exp: number } | null = null

function jsonError(c: any, status: number, error: string) {
  return c.json({ ok: false, error }, status)
}
function b64url(bytes: Uint8Array) {
  let s = ''
  bytes.forEach(b => s += String.fromCharCode(b))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function b64urlText(s: string) { return b64url(enc.encode(s)) }
function fromB64url(s: string) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const raw = atob(s)
  return Uint8Array.from(raw, ch => ch.charCodeAt(0))
}
function utf8ToB64(s: string) {
  let raw = ''
  enc.encode(s).forEach(b => raw += String.fromCharCode(b))
  return btoa(raw)
}
function b64ToUtf8(s: string) {
  const raw = atob(s.replace(/\n/g, ''))
  return dec.decode(Uint8Array.from(raw, ch => ch.charCodeAt(0)))
}
function randomBytes(n: number) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b }
function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b)
  if (x.length !== y.length) return false
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}
async function pbkdf2(value: string, saltB64: string, iterations = 240000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(value), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(saltB64), iterations }, key, 256)
  return b64url(new Uint8Array(bits))
}
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))))
}
async function signToken(secret: string, payload: Record<string, unknown>, ttlSec: number) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }
  const part = b64urlText(JSON.stringify(body))
  return part + '.' + await hmac(secret, part)
}
async function verifyToken(secret: string, token: string) {
  const [part, sig, extra] = String(token || '').split('.')
  if (!part || !sig || extra) return null
  const expected = await hmac(secret, part)
  if (!timingSafeEqual(sig, expected)) return null
  try {
    const obj = JSON.parse(dec.decode(fromB64url(part)))
    if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null
    return obj
  } catch { return null }
}
async function aesKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function encryptSecret(master: string, plaintext: string) {
  const iv = randomBytes(12), key = await aesKey(master)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)))
  return { iv: b64url(iv), ciphertext: b64url(ct) }
}
async function decryptSecret(master: string, box: { iv: string; ciphertext: string }) {
  const key = await aesKey(master)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(box.iv) }, key, fromB64url(box.ciphertext))
  return dec.decode(plain)
}
function bytesToBase32(bytes: Uint8Array) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += alpha[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) out += alpha[(value << (5 - bits)) & 31]
  return out
}
function base32ToBytes(s: string) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0; const out: number[] = []
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = alpha.indexOf(ch); if (i < 0) continue
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return new Uint8Array(out)
}
async function totp(secret: string, offset = 0) {
  const key = await crypto.subtle.importKey('raw', base32ToBytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  let counter = Math.floor(Date.now() / 30000) + offset
  const msg = new Uint8Array(8)
  for (let i = 7; i >= 0; i--) { msg[i] = counter & 255; counter = Math.floor(counter / 256) }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = sig[sig.length - 1] & 15
  const n = (((sig[o] & 127) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3]) % 1000000
  return String(n).padStart(6, '0')
}
async function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false
  for (const o of [-1, 0, 1]) if (timingSafeEqual(await totp(secret, o), code)) return true
  return false
}
function pemToSpki(pem: string) {
  const clean = pem.replace(/\\n/g, '\n').replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '').replace(/-----END (RSA )?PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0))
  // GitHub commonly supplies PKCS#8. If a PKCS#1 key is supplied, import will fail with a clear setup error.
  return der
}
async function githubAppJwt(env: Bindings) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_PRIVATE_KEY) throw new Error('GitHub App secrets are incomplete')
  const now = Math.floor(Date.now() / 1000)
  const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64urlText(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))
  const input = header + '.' + payload
  const key = await crypto.subtle.importKey('pkcs8', pemToSpki(env.GITHUB_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input)))
  return input + '.' + b64url(sig)
}
async function githubToken(env: Bindings) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN
  if (appTokenCache && appTokenCache.exp > Date.now() + 120000) return appTokenCache.token
  if (!env.GITHUB_INSTALLATION_ID) throw new Error('GITHUB_INSTALLATION_ID is missing')
  const jwt = await githubAppJwt(env)
  const r = await fetch(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST', headers: { 'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${jwt}`, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'grade3-math-auth' }
  })
  if (!r.ok) throw new Error(`GitHub installation token failed: ${r.status} ${await r.text()}`)
  const data: any = await r.json()
  appTokenCache = { token: data.token, exp: new Date(data.expires_at).getTime() }
  return data.token
}
async function gh(env: Bindings, path: string, init: RequestInit = {}) {
  const token = await githubToken(env)
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-GitHub-Api-Version', API_VERSION)
  headers.set('User-Agent', 'grade3-math-auth')
  const r = await fetch(`https://api.github.com${path}`, { ...init, headers })
  return r
}
function userPath(username: string) { return `users/${username}.json` }
async function readUser(env: Bindings, username: string): Promise<{ user: UserRecord; sha: string } | null> {
  const p = encodeURIComponent(userPath(username)).replace(/%2F/g, '/')
  const r = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${p}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status} ${await r.text()}`)
  const data: any = await r.json()
  return { user: JSON.parse(b64ToUtf8(data.content)), sha: data.sha }
}
async function writeUser(env: Bindings, user: UserRecord, sha?: string, message = 'Update learner record') {
  const p = encodeURIComponent(userPath(user.username)).replace(/%2F/g, '/')
  const body: any = { message, content: utf8ToB64(JSON.stringify(user, null, 2) + '\n'), branch: env.GITHUB_BRANCH || 'main' }
  if (sha) body.sha = sha
  const r = await gh(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`GitHub write failed: ${r.status} ${await r.text()}`)
}
function publicUser(u: UserRecord) {
  return { username: u.username, progress: u.progress }
}
async function sessionUser(c: any): Promise<UserRecord | null> {
  const h = c.req.header('Authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  const p: any = await verifyToken(c.env.SESSION_SECRET, token)
  if (!p || p.typ !== 'session' || !USER_RE.test(p.sub || '')) return null
  const row = await readUser(c.env, p.sub)
  return row?.user || null
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  const allowed = origin === c.env.FRONTEND_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  if (origin && !allowed) return jsonError(c, 403, 'Origin not allowed')
  if (allowed) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

app.get('/health', c => c.json({ ok: true, service: 'grade3-math-auth' }))
app.use('/api/register/*', async (c, next) => {
  if (c.env.AUTH_RATE_LIMITER) { const r = await c.env.AUTH_RATE_LIMITER.limit({ key: c.req.header('CF-Connecting-IP') || 'unknown' }); if (!r.success) return jsonError(c, 429, 'Too many authentication attempts. Try again shortly.') }
  await next()
})
app.use('/api/login/*', async (c, next) => {
  if (c.env.AUTH_RATE_LIMITER) { const r = await c.env.AUTH_RATE_LIMITER.limit({ key: c.req.header('CF-Connecting-IP') || 'unknown' }); if (!r.success) return jsonError(c, 429, 'Too many authentication attempts. Try again shortly.') }
  await next()
})


app.post('/api/register/start', async c => {
  try {
    const b: any = await c.req.json()
    const username = String(b.username || '').trim(), password = String(b.password || ''), answer = String(b.securityAnswer || '').trim(), question = String(b.securityQuestion || '').trim()
    if (!USER_RE.test(username)) return jsonError(c, 400, 'Username must match the required six-character pattern.')
    if (!PASS_RE.test(password)) return jsonError(c, 400, 'Password does not meet the password policy.')
    if (question.length < 3 || question.length > 100 || answer.length < 4 || answer.length > 100) return jsonError(c, 400, 'Security question or answer is invalid.')
    if (await readUser(c.env, username)) return jsonError(c, 409, 'That username already exists.')
    const pSalt = b64url(randomBytes(16)), aSalt = b64url(randomBytes(16)), iterations = 240000
    const secret = bytesToBase32(randomBytes(20))
    const payload = {
      typ: 'registration', username, question,
      password: { salt: pSalt, iterations, hash: await pbkdf2(password, pSalt, iterations) },
      security: { salt: aSalt, iterations, answerHash: await pbkdf2(answer.toLowerCase(), aSalt, iterations) },
      totp: await encryptSecret(c.env.DATA_ENCRYPTION_KEY, secret)
    }
    const challenge = await signToken(c.env.SESSION_SECRET, payload, 600)
    const uri = `otpauth://totp/Grade3Math:${encodeURIComponent(username)}?secret=${secret}&issuer=Grade3Math&algorithm=SHA1&digits=6&period=30`
    return c.json({ ok: true, challenge, totpSecret: secret, otpauthUri: uri, expiresIn: 600 })
  } catch (e: any) { return jsonError(c, 500, e.message || 'Registration setup failed.') }
})

app.post('/api/register/finish', async c => {
  try {
    const b: any = await c.req.json(), p: any = await verifyToken(c.env.SESSION_SECRET, String(b.challenge || ''))
    if (!p || p.typ !== 'registration') return jsonError(c, 400, 'Registration challenge expired. Start registration again.')
    if (await readUser(c.env, p.username)) return jsonError(c, 409, 'That username already exists.')
    const secret = await decryptSecret(c.env.DATA_ENCRYPTION_KEY, p.totp)
    if (!(await verifyTotp(secret, String(b.code || '')))) return jsonError(c, 401, 'Authenticator code is incorrect or expired.')
    const now = new Date().toISOString()
    const user: UserRecord = {
      schemaVersion: 1, username: p.username, createdAt: now,
      auth: p.password,
      security: { question: p.question, ...p.security },
      totp: p.totp,
      progress: { highestUnlocked: 1, attempted: 0, correct: 0, sessions: 0, topics: {}, updatedAt: now }
    }
    await writeUser(c.env, user, undefined, `Create learner ${user.username}`)
    return c.json({ ok: true, username: user.username })
  } catch (e: any) { return jsonError(c, 500, e.message || 'Registration failed.') }
})

app.post('/api/login/password', async c => {
  try {
    const b: any = await c.req.json(), username = String(b.username || '').trim(), password = String(b.password || '')
    if (!USER_RE.test(username)) return jsonError(c, 401, 'Username or password is incorrect.')
    const row = await readUser(c.env, username)
    if (!row) return jsonError(c, 401, 'Username or password is incorrect.')
    const hash = await pbkdf2(password, row.user.auth.salt, row.user.auth.iterations)
    if (!timingSafeEqual(hash, row.user.auth.hash)) return jsonError(c, 401, 'Username or password is incorrect.')
    const challenge = await signToken(c.env.SESSION_SECRET, { typ: 'login-mfa', sub: username, nonce: b64url(randomBytes(12)) }, 300)
    return c.json({ ok: true, challenge, expiresIn: 300 })
  } catch (e: any) { return jsonError(c, 500, e.message || 'Login verification failed.') }
})

app.post('/api/login/mfa', async c => {
  try {
    const b: any = await c.req.json(), p: any = await verifyToken(c.env.SESSION_SECRET, String(b.challenge || ''))
    if (!p || p.typ !== 'login-mfa' || !USER_RE.test(p.sub || '')) return jsonError(c, 401, 'Login challenge expired. Verify your password again.')
    const row = await readUser(c.env, p.sub)
    if (!row) return jsonError(c, 401, 'Account not found.')
    const secret = await decryptSecret(c.env.DATA_ENCRYPTION_KEY, row.user.totp)
    if (!(await verifyTotp(secret, String(b.code || '')))) return jsonError(c, 401, 'Authenticator code is incorrect or expired.')
    const token = await signToken(c.env.SESSION_SECRET, { typ: 'session', sub: p.sub, nonce: b64url(randomBytes(12)) }, 8 * 3600)
    return c.json({ ok: true, token, expiresIn: 8 * 3600, user: publicUser(row.user) })
  } catch (e: any) { return jsonError(c, 500, e.message || 'MFA verification failed.') }
})

app.get('/api/me', async c => {
  try { const u = await sessionUser(c); return u ? c.json({ ok: true, user: publicUser(u) }) : jsonError(c, 401, 'Login required.') }
  catch (e: any) { return jsonError(c, 500, e.message || 'Unable to load account.') }
})

app.get('/api/progress', async c => {
  try { const u = await sessionUser(c); return u ? c.json({ ok: true, progress: u.progress }) : jsonError(c, 401, 'Login required.') }
  catch (e: any) { return jsonError(c, 500, e.message || 'Unable to load progress.') }
})

async function mutateUser(c: any, fn: (u: UserRecord) => void, message: string) {
  const h = c.req.header('Authorization') || '', token = h.startsWith('Bearer ') ? h.slice(7) : ''
  const p: any = await verifyToken(c.env.SESSION_SECRET, token)
  if (!p || p.typ !== 'session') return jsonError(c, 401, 'Login required.')
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readUser(c.env, p.sub); if (!row) return jsonError(c, 404, 'Account not found.')
    fn(row.user); row.user.progress.updatedAt = new Date().toISOString()
    try { await writeUser(c.env, row.user, row.sha, message); return c.json({ ok: true, progress: row.user.progress }) }
    catch (e: any) { if (attempt === 2 || !String(e.message).includes('409')) throw e }
  }
  return jsonError(c, 409, 'Progress changed concurrently. Try again.')
}

app.post('/api/progress/attempt', async c => {
  try {
    const b: any = await c.req.json(), topic = String(b.topic || 'Other').slice(0, 120), correct = !!b.correct
    return mutateUser(c, u => {
      u.progress.attempted++; if (correct) u.progress.correct++
      const t = u.progress.topics[topic] ||= { attempted: 0, correct: 0 }
      t.attempted++; if (correct) t.correct++
    }, 'Record question attempt')
  } catch (e: any) { return jsonError(c, 500, e.message || 'Unable to record attempt.') }
})
app.post('/api/progress/session', async c => {
  try { return mutateUser(c, u => { u.progress.sessions++ }, 'Record completed session') }
  catch (e: any) { return jsonError(c, 500, e.message || 'Unable to record session.') }
})
app.post('/api/progress/unlock', async c => {
  try {
    const b: any = await c.req.json(), completedLevel = Math.max(1, Math.min(5, Number(b.completedLevel) || 1)), scorePct = Number(b.scorePct)
    if (scorePct !== 100) return jsonError(c, 400, 'A 100% assessment score is required to unlock the next level.')
    return mutateUser(c, u => { u.progress.highestUnlocked = Math.max(u.progress.highestUnlocked, Math.min(5, completedLevel + 1)) }, 'Unlock next learning level')
  } catch (e: any) { return jsonError(c, 500, e.message || 'Unable to unlock level.') }
})

app.notFound(c => jsonError(c, 404, 'Not found.'))
export default app
