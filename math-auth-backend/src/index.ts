import { Hono } from 'hono'

type RateLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> }
type Bindings = {
  FRONTEND_ORIGIN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  SESSION_SECRET: string
  DATA_ENCRYPTION_KEY: string
  PASSWORD_PEPPER: string
  GITHUB_TOKEN?: string
  GITHUB_APP_ID?: string
  GITHUB_INSTALLATION_ID?: string
  GITHUB_PRIVATE_KEY?: string
  AUTH_IP_RATE_LIMITER?: RateLimiter
  AUTH_ACCOUNT_RATE_LIMITER?: RateLimiter
  PROGRESS_RATE_LIMITER?: RateLimiter
}

type CredentialHash = {
  algorithm?: 'PBKDF2-HMAC-SHA256' | 'CLIENT-PBKDF2-SHA256-HMAC-SHA256-v1'
  salt: string
  iterations: number
  hash: string
  peppered?: boolean
}
type ClientCredentialInput = {
  algorithm: 'PBKDF2-SHA256'
  salt: string
  iterations: number
  verifier: string
}
type TopicStat = { attempted: number; correct: number }
type UserRecord = {
  schemaVersion: 1 | 2 | 3
  username: string
  createdAt: string
  consent?: { noticeVersion: string; acceptedAt: string }
  auth: CredentialHash
  security: { question: string; algorithm?: CredentialHash['algorithm']; salt: string; iterations: number; answerHash: string; peppered?: boolean }
  totp: { version?: number; iv: string; ciphertext: string; lastUsedCounter?: number }
  session?: { id: string; issuedAt: string }
  progress: {
    highestUnlocked: number
    attempted: number
    correct: number
    sessions: number
    topics: Record<string, TopicStat>
    updatedAt: string
  }
}

type TokenPayload = Record<string, unknown> & { typ: string }

const SERVICE = 'math-auth'
const ISSUER = 'Grade3Math'
const API_VERSION = '2026-03-10'
const USER_RE = /^[A-Z][a-z][0-9]{2}[A-Za-z]{2}$/
const PASSWORD_ITERATIONS = 600_000
const CLIENT_CREDENTIAL_ALGORITHM = 'CLIENT-PBKDF2-SHA256-HMAC-SHA256-v1' as const
const CLIENT_KDF_ALGORITHM = 'PBKDF2-SHA256' as const
const MAX_BODY_BYTES = 8 * 1024
const MAX_USER_RECORD_BYTES = 128 * 1024
const MAX_TOPIC_COUNT = 160
const MAX_TOPIC_LENGTH = 96
const MAX_COUNTER = 1_000_000_000
const SESSION_TTL_SEC = 2 * 60 * 60
const LOGIN_CHALLENGE_TTL_SEC = 5 * 60
const REGISTRATION_TTL_SEC = 15 * 60
const CAPTCHA_TTL_SEC = 15 * 60
const PRIVACY_NOTICE_VERSION = '2026-08-08.v1'
const RESERVED_TOPIC_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const SECURITY_QUESTIONS = new Set(['shape', 'planet', 'word'])
const COMMON_PASSWORDS = new Set([
  'password123!', 'password1234', 'password12345', 'password123456', 'passwordpassword', 'password!@#$',
  'qwerty123456', 'qwertyuiop12', 'qwertyuiop123', 'letmein123456', 'welcome123456', 'admin12345678',
  'administrator1', 'iloveyou12345', '123456789012', '1234567890ab', '111111111111', '000000000000',
  'abcdefghijkl', 'abcdefgh1234', 'abc123abc123', 'monkey123456', 'dragon123456', 'football1234',
  'baseball1234', 'sunshine1234', 'princess1234', 'computer1234', 'whatever1234', 'starwars1234',
  'superman1234', 'pokemon123456', 'minecraft1234', 'chocolate1234', '1q2w3e4r5t6y', 'qazwsxedc123',
  'zaq12wsx34edc', 'purple comet 47 river!', 'grade3math123', 'mathematics123'
])
const CONTEXT_PASSWORD_TERMS = ['grade3math', 'mijicuet', 'math-auth']

const app = new Hono<{ Bindings: Bindings }>()
const enc = new TextEncoder()
const dec = new TextDecoder()
const requestDec = new TextDecoder('utf-8', { fatal: true })
let appTokenCache: { token: string; exp: number; scope: string } | null = null

class AppError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function jsonError(c: any, status: number, error: string) {
  return c.json({ ok: false, error }, status as any)
}
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function b64url(bytes: Uint8Array) {
  let s = ''
  bytes.forEach(b => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function fromB64url(input: string) {
  let s = input.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const raw = atob(s)
  return Uint8Array.from(raw, ch => ch.charCodeAt(0))
}
function validB64urlBytes(input: unknown, minBytes: number, maxBytes: number) {
  if (typeof input !== 'string' || input.length > Math.ceil(maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(input)) return false
  try { const n = fromB64url(input).byteLength; return n >= minBytes && n <= maxBytes } catch { return false }
}
function utf8ToB64(s: string) {
  let raw = ''
  enc.encode(s).forEach(b => { raw += String.fromCharCode(b) })
  return btoa(raw)
}
function b64ToUtf8(s: string) {
  const raw = atob(s.replace(/\s/g, ''))
  return dec.decode(Uint8Array.from(raw, ch => ch.charCodeAt(0)))
}
function randomBytes(n: number) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}
function randomInt(min: number, max: number) {
  const span = max - min + 1
  const limit = Math.floor(0x100000000 / span) * span
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf); while (buf[0] >= limit)
  return min + (buf[0] % span)
}
function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b)
  if (x.length !== y.length) return false
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}
function codePointLength(s: string) { return Array.from(s).length }
function normalizeAnswer(s: string) { return s.normalize('NFKC').trim().toLocaleLowerCase('en-US') }
function validSecurityAnswer(s: string) {
  const n = codePointLength(s)
  return n >= 6 && n <= 100 && !/[\u0000-\u001F\u007F]/u.test(s)
}
function normalizePassword(password: string) { return password.normalize('NFC') }
function validatePassword(password: string, username: string) {
  const n = codePointLength(password)
  if (n < 12 || n > 128) return false
  if (/[\u0000-\u001F\u007F]/u.test(password)) return false
  const low = password.toLocaleLowerCase('en-US')
  if (low.includes(username.toLocaleLowerCase('en-US'))) return false
  if (COMMON_PASSWORDS.has(low) || CONTEXT_PASSWORD_TERMS.some(term => low.includes(term))) return false
  return true
}
function safeTopic(topic: string) {
  const n = codePointLength(topic)
  return n >= 1 && n <= MAX_TOPIC_LENGTH &&
    !RESERVED_TOPIC_KEYS.has(topic) &&
    !/[\u0000-\u001F\u007F<>]/u.test(topic)
}
function clampInt(value: unknown, min: number, max: number, fallback = min) {
  const n = Number(value)
  if (!Number.isInteger(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
function configProblem(env: Bindings) {
  const required: Array<[string, string | undefined]> = [
    ['FRONTEND_ORIGIN', env.FRONTEND_ORIGIN], ['GITHUB_OWNER', env.GITHUB_OWNER],
    ['GITHUB_REPO', env.GITHUB_REPO], ['GITHUB_BRANCH', env.GITHUB_BRANCH],
    ['SESSION_SECRET', env.SESSION_SECRET], ['DATA_ENCRYPTION_KEY', env.DATA_ENCRYPTION_KEY],
    ['PASSWORD_PEPPER', env.PASSWORD_PEPPER]
  ]
  if (required.some(([, value]) => !value)) return 'Required configuration is missing.'
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(env.FRONTEND_ORIGIN)) return 'FRONTEND_ORIGIN must be an HTTPS origin.'
  if (!/^[A-Za-z0-9_.-]+$/.test(env.GITHUB_OWNER) || !/^[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO)) return 'GitHub repository configuration is invalid.'
  if (!/^[A-Za-z0-9._\/-]+$/.test(env.GITHUB_BRANCH)) return 'GitHub branch configuration is invalid.'
  if (env.SESSION_SECRET.length < 40 || env.DATA_ENCRYPTION_KEY.length < 40 || env.PASSWORD_PEPPER.length < 40) return 'Cryptographic secrets are too short.'
  if (new Set([env.SESSION_SECRET, env.DATA_ENCRYPTION_KEY, env.PASSWORD_PEPPER]).size !== 3) return 'Cryptographic secrets must be different values.'
  if (!env.AUTH_IP_RATE_LIMITER || !env.AUTH_ACCOUNT_RATE_LIMITER || !env.PROGRESS_RATE_LIMITER) return 'Required rate-limit bindings are missing.'
  const appFields = [env.GITHUB_APP_ID, env.GITHUB_INSTALLATION_ID, env.GITHUB_PRIVATE_KEY]
  const hasAnyApp = appFields.some(Boolean), hasAllApp = appFields.every(Boolean)
  if (env.GITHUB_TOKEN && hasAnyApp) return 'Configure either GITHUB_TOKEN or GitHub App credentials, not both.'
  if (!env.GITHUB_TOKEN && !hasAllApp) return 'A GitHub credential is required.'
  return ''
}
function assertConfig(env: Bindings) {
  if (configProblem(env)) throw new AppError(503, 'Backend configuration is incomplete.')
}

async function hmacBytes(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}
async function hmacText(secret: string, data: string) { return b64url(await hmacBytes(secret, data)) }
async function derivedAesKey(secret: string, purpose: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${SERVICE}\0${purpose}\0${secret}`))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function sealToken(secret: string, payload: TokenPayload, ttlSec: number) {
  const now = Math.floor(Date.now() / 1000)
  // Reserved envelope fields are written last so a future caller cannot override them.
  const body = { ...payload, iss: SERVICE, iat: now, exp: now + ttlSec }
  const iv = randomBytes(12), key = await derivedAesKey(secret, 'token-v1')
  const aad = enc.encode(`${SERVICE}/token/v1`)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode(JSON.stringify(body))))
  return `v1.${b64url(iv)}.${b64url(ct)}`
}
async function openToken(secret: string, token: string): Promise<Record<string, any> | null> {
  const rawToken = String(token || '')
  if (rawToken.length < 32 || rawToken.length > 4096) return null
  const [version, ivPart, ctPart, extra] = rawToken.split('.')
  if (version !== 'v1' || !ivPart || !ctPart || extra) return null
  try {
    if (!validB64urlBytes(ivPart, 12, 12) || !validB64urlBytes(ctPart, 17, 3072)) return null
    const key = await derivedAesKey(secret, 'token-v1')
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64url(ivPart), additionalData: enc.encode(`${SERVICE}/token/v1`) },
      key, fromB64url(ctPart)
    )
    const parsed = JSON.parse(dec.decode(plain))
    if (!isObject(parsed)) return null
    const obj = parsed as Record<string, any>
    const now = Math.floor(Date.now() / 1000)
    if (obj.iss !== SERVICE || !Number.isInteger(obj.iat) || !Number.isInteger(obj.exp) || obj.exp <= obj.iat) return null
    const ttlByType: Record<string, number> = {
      captcha: CAPTCHA_TTL_SEC, registration: REGISTRATION_TTL_SEC,
      'login-mfa': LOGIN_CHALLENGE_TTL_SEC, session: SESSION_TTL_SEC
    }
    const ttlLimit = ttlByType[String(obj.typ || '')]
    if (!ttlLimit || obj.iat > now + 60 || obj.exp < now || obj.exp - obj.iat > ttlLimit) return null
    return obj
  } catch { return null }
}
function parseClientCredential(raw: unknown): ClientCredentialInput {
  if (!isObject(raw) || raw.algorithm !== CLIENT_KDF_ALGORITHM || Number(raw.iterations) !== PASSWORD_ITERATIONS ||
      !validB64urlBytes(raw.salt, 16, 16) || !validB64urlBytes(raw.verifier, 32, 32)) {
    throw new AppError(400, 'Credential derivation data is invalid.')
  }
  return { algorithm: CLIENT_KDF_ALGORITHM, salt: String(raw.salt), iterations: PASSWORD_ITERATIONS, verifier: String(raw.verifier) }
}
async function verifierMac(env: Bindings, username: string, domain: string, verifier: string) {
  return hmacText(env.PASSWORD_PEPPER, `client-verifier-v1\0${domain}\0${username}\0${verifier}`)
}
async function protectClientCredential(raw: unknown, env: Bindings, username: string, domain: string): Promise<CredentialHash> {
  const input = parseClientCredential(raw)
  return {
    algorithm: CLIENT_CREDENTIAL_ALGORITHM,
    salt: input.salt,
    iterations: input.iterations,
    peppered: true,
    hash: await verifierMac(env, username, domain, input.verifier)
  }
}
function isClientCredential(stored: CredentialHash) {
  return stored.algorithm === CLIENT_CREDENTIAL_ALGORITHM && stored.iterations === PASSWORD_ITERATIONS && stored.peppered === true
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
    const i = alpha.indexOf(ch)
    if (i < 0) throw new Error('Invalid Base32 data')
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return new Uint8Array(out)
}
async function totpAtCounter(secret: string, counterInput: number) {
  const key = await crypto.subtle.importKey('raw', base32ToBytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  let counter = counterInput
  const msg = new Uint8Array(8)
  for (let i = 7; i >= 0; i--) { msg[i] = counter & 255; counter = Math.floor(counter / 256) }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = sig[sig.length - 1] & 15
  const n = (((sig[o] & 127) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3]) % 1_000_000
  return String(n).padStart(6, '0')
}
async function matchingTotpCounter(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return null
  const current = Math.floor(Date.now() / 30_000)
  for (const offset of [-1, 0, 1]) {
    const counter = current + offset
    if (timingSafeEqual(await totpAtCounter(secret, counter), code)) return counter
  }
  return null
}
async function encryptTotp(master: string, username: string, secret: string) {
  const iv = randomBytes(12), key = await derivedAesKey(master, 'totp-v2')
  const aad = enc.encode(`${SERVICE}/totp/${username}`)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode(secret)))
  return { version: 2, iv: b64url(iv), ciphertext: b64url(ct) }
}
async function decryptTotp(master: string, username: string, box: UserRecord['totp']) {
  try {
    if ((box.version || 1) >= 2) {
      const key = await derivedAesKey(master, 'totp-v2')
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64url(box.iv), additionalData: enc.encode(`${SERVICE}/totp/${username}`) },
        key, fromB64url(box.ciphertext)
      )
      return dec.decode(plain)
    }
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(master))
    const legacyKey = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(box.iv) }, legacyKey, fromB64url(box.ciphertext))
    return dec.decode(plain)
  } catch { throw new AppError(500, 'Authenticator data could not be read.') }
}

function derLength(n: number) {
  if (n < 128) return new Uint8Array([n])
  const bytes: number[] = []
  while (n > 0) { bytes.unshift(n & 255); n >>>= 8 }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}
function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
function derWrap(tag: number, body: Uint8Array) { return concatBytes(new Uint8Array([tag]), derLength(body.length), body) }
function pemPrivateKeyToPkcs8(pem: string) {
  const normalized = pem.replace(/\\n/g, '\n').trim()
  const isPkcs1 = normalized.includes('-----BEGIN RSA PRIVATE KEY-----')
  const clean = normalized
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  let der: Uint8Array
  try { der = Uint8Array.from(atob(clean), c => c.charCodeAt(0)) }
  catch { throw new AppError(503, 'GitHub App private key format is invalid.') }
  if (!isPkcs1) return der
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const rsaAlg = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])
  return derWrap(0x30, concatBytes(version, rsaAlg, derWrap(0x04, der)))
}
async function githubAppJwt(env: Bindings) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_PRIVATE_KEY) throw new AppError(503, 'GitHub App credentials are incomplete.')
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = b64url(enc.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })))
  const input = `${header}.${payload}`
  const key = await crypto.subtle.importKey('pkcs8', pemPrivateKeyToPkcs8(env.GITHUB_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input)))
  return `${input}.${b64url(sig)}`
}
async function githubToken(env: Bindings) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN
  const cacheScope = `${env.GITHUB_APP_ID || ''}:${env.GITHUB_INSTALLATION_ID || ''}:${env.GITHUB_OWNER}/${env.GITHUB_REPO}`
  if (appTokenCache && appTokenCache.scope === cacheScope && appTokenCache.exp > Date.now() + 120_000) return appTokenCache.token
  if (!env.GITHUB_INSTALLATION_ID) throw new AppError(503, 'GitHub App installation is not configured.')
  const jwt = await githubAppJwt(env)
  const r = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json', 'Authorization': `Bearer ${jwt}`,
      'X-GitHub-Api-Version': API_VERSION, 'User-Agent': SERVICE, 'Content-Type': 'application/json'
    },
    body: JSON.stringify({ repositories: [env.GITHUB_REPO], permissions: { contents: 'write' } })
  })
  if (!r.ok) throw new GitHubError(r.status, 'GitHub installation token request failed.')
  const data: any = await r.json()
  const expiresAt = typeof data?.expires_at === 'string' ? Date.parse(data.expires_at) : NaN
  if (typeof data?.token !== 'string' || data.token.length < 20 || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) throw new GitHubError(502, 'GitHub installation token response was invalid.')
  appTokenCache = { token: data.token, exp: expiresAt, scope: cacheScope }
  return appTokenCache.token
}
async function gh(env: Bindings, path: string, init: RequestInit = {}) {
  const token = await githubToken(env)
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-GitHub-Api-Version', API_VERSION)
  headers.set('User-Agent', SERVICE)
  return fetch(`https://api.github.com${path}`, { ...init, headers })
}
function userPath(username: string) { return `users/${username}.json` }
function normalizeProgress(raw: unknown): UserRecord['progress'] {
  const r = isObject(raw) ? raw : {}
  const topics: Record<string, TopicStat> = Object.create(null)
  if (isObject(r.topics)) {
    let count = 0
    for (const [topic, stat] of Object.entries(r.topics)) {
      if (count >= MAX_TOPIC_COUNT || !safeTopic(topic) || !isObject(stat)) continue
      const attempted = clampInt(stat.attempted, 0, MAX_COUNTER, 0)
      const correct = Math.min(attempted, clampInt(stat.correct, 0, MAX_COUNTER, 0))
      topics[topic] = { attempted, correct }; count++
    }
  }
  const attempted = clampInt(r.attempted, 0, MAX_COUNTER, 0)
  const correct = Math.min(attempted, clampInt(r.correct, 0, MAX_COUNTER, 0))
  return {
    highestUnlocked: clampInt(r.highestUnlocked, 1, 5, 1), attempted, correct,
    sessions: clampInt(r.sessions, 0, MAX_COUNTER, 0), topics,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 40) : new Date(0).toISOString()
  }
}
function normalizeCredential(raw: unknown): CredentialHash {
  if (!isObject(raw) || !validB64urlBytes(raw.salt, 16, 32) || !validB64urlBytes(raw.hash, 32, 32)) throw new Error('Invalid credential record')
  const algorithm = raw.algorithm === CLIENT_CREDENTIAL_ALGORITHM ? CLIENT_CREDENTIAL_ALGORITHM
    : raw.algorithm === 'PBKDF2-HMAC-SHA256' ? 'PBKDF2-HMAC-SHA256' : undefined
  const iterations = clampInt(raw.iterations, 100_000, 2_000_000, 240_000)
  if (algorithm === CLIENT_CREDENTIAL_ALGORITHM && (iterations !== PASSWORD_ITERATIONS || raw.peppered !== true)) throw new Error('Invalid client credential record')
  return { algorithm, salt: String(raw.salt), hash: String(raw.hash), iterations, peppered: raw.peppered === true }
}
function normalizeUser(raw: unknown, expectedUsername: string): UserRecord {
  if (!isObject(raw) || raw.username !== expectedUsername || !USER_RE.test(expectedUsername)) throw new Error('Invalid learner record')
  if (!isObject(raw.security) || !isObject(raw.totp)) throw new Error('Invalid learner record')
  const security = raw.security
  const totp = raw.totp
  if (typeof security.question !== 'string' || !SECURITY_QUESTIONS.has(security.question) || !validB64urlBytes(security.salt, 16, 32) || !validB64urlBytes(security.answerHash, 32, 32)) throw new Error('Invalid learner record')
  if (!validB64urlBytes(totp.iv, 12, 12) || !validB64urlBytes(totp.ciphertext, 17, 128)) throw new Error('Invalid learner record')
  const auth = normalizeCredential(raw.auth)
  const schemaVersion = raw.schemaVersion === 3 ? 3 : raw.schemaVersion === 2 ? 2 : 1
  if (schemaVersion === 3) {
    if (!isClientCredential(auth) || security.algorithm !== CLIENT_CREDENTIAL_ALGORITHM || Number(security.iterations) !== PASSWORD_ITERATIONS || security.peppered !== true) throw new Error('Invalid version 3 learner record')
  }
  return {
    schemaVersion,
    username: expectedUsername,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : new Date(0).toISOString(),
    ...(isObject(raw.consent) && typeof raw.consent.noticeVersion === 'string' && typeof raw.consent.acceptedAt === 'string'
      ? { consent: { noticeVersion: raw.consent.noticeVersion.slice(0, 40), acceptedAt: raw.consent.acceptedAt.slice(0, 40) } } : {}),
    auth,
    security: {
      question: String(security.question).slice(0, 40),
      algorithm: security.algorithm === CLIENT_CREDENTIAL_ALGORITHM ? CLIENT_CREDENTIAL_ALGORITHM
        : security.algorithm === 'PBKDF2-HMAC-SHA256' ? 'PBKDF2-HMAC-SHA256' : undefined,
      salt: String(security.salt),
      iterations: clampInt(security.iterations, 100_000, 2_000_000, 240_000),
      answerHash: String(security.answerHash), peppered: security.peppered === true
    },
    totp: {
      version: clampInt(totp.version, 1, 2, 1), iv: String(totp.iv), ciphertext: String(totp.ciphertext),
      lastUsedCounter: Number.isInteger(totp.lastUsedCounter) ? clampInt(totp.lastUsedCounter, 0, MAX_COUNTER, 0) : undefined
    },
    ...(isObject(raw.session) && validB64urlBytes(raw.session.id, 16, 32) && typeof raw.session.issuedAt === 'string'
      ? { session: { id: String(raw.session.id), issuedAt: raw.session.issuedAt.slice(0, 40) } } : {}),
    progress: normalizeProgress(raw.progress)
  }
}
async function readUser(env: Bindings, username: string): Promise<{ user: UserRecord; sha: string } | null> {
  if (!USER_RE.test(username)) return null
  const p = encodeURIComponent(userPath(username)).replace(/%2F/g, '/')
  const r = await gh(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${p}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`)
  if (r.status === 404) return null
  if (!r.ok) throw new GitHubError(r.status, 'GitHub learner-record read failed.')
  const data: any = await r.json()
  const size = Number(data?.size)
  if (!data || data.encoding !== 'base64' || typeof data.content !== 'string' || typeof data.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(data.sha) || !Number.isInteger(size) || size < 2 || size > MAX_USER_RECORD_BYTES || data.content.length > Math.ceil(MAX_USER_RECORD_BYTES * 4 / 3) + 4096) throw new GitHubError(502, 'GitHub learner-record response was invalid.')
  try { return { user: normalizeUser(JSON.parse(b64ToUtf8(data.content)), username), sha: data.sha } }
  catch { throw new GitHubError(502, 'Stored learner record is invalid.') }
}
async function writeUser(env: Bindings, user: UserRecord, sha?: string, message = 'Update learner record') {
  const normalized = normalizeUser(user, user.username)
  const text = JSON.stringify(normalized, null, 2) + '\n'
  if (enc.encode(text).byteLength > MAX_USER_RECORD_BYTES) throw new AppError(413, 'Learner record is too large.')
  const p = encodeURIComponent(userPath(normalized.username)).replace(/%2F/g, '/')
  const body: Record<string, unknown> = { message, content: utf8ToB64(text), branch: env.GITHUB_BRANCH || 'main' }
  if (sha) body.sha = sha
  const r = await gh(env, `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${p}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  if (!r.ok) throw new GitHubError(r.status, 'GitHub learner-record write failed.')
}
function publicUser(u: UserRecord) { return { username: u.username, progress: u.progress } }

async function readJson(c: any) {
  const contentType = c.req.header('Content-Type') || ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new AppError(415, 'Content-Type must be application/json.')
  const declared = Number(c.req.header('Content-Length') || '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError(413, 'Request body is too large.')
  const body = c.req.raw.body
  let raw = ''
  if (body) {
    const reader = body.getReader(), chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new AppError(413, 'Request body is too large.') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    try { raw = requestDec.decode(concatBytes(...chunks)) }
    catch { throw new AppError(400, 'Request body must be valid UTF-8 JSON.') }
  }
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!isObject(parsed)) throw new Error('not object')
    return parsed as Record<string, unknown>
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError(400, 'Request body must be a JSON object.')
  }
}

function clientIp(c: any) { return c.req.header('CF-Connecting-IP') || 'unknown' }
async function applyRateLimit(binding: RateLimiter | undefined, key: string) {
  if (!binding) return
  const r = await binding.limit({ key })
  if (!r.success) throw new AppError(429, 'Too many requests. Try again shortly.')
}
async function authIpLimit(c: any, label: string) { await applyRateLimit(c.env.AUTH_IP_RATE_LIMITER, `${label}:ip:${clientIp(c)}`) }
async function accountLimit(c: any, label: string, username: string) { await applyRateLimit(c.env.AUTH_ACCOUNT_RATE_LIMITER, `${label}:user:${username}`) }
async function captchaIpTag(env: Bindings, ip: string) { return hmacText(env.SESSION_SECRET, `captcha-ip\0${ip}`) }

async function sessionPayload(c: any) {
  const h = c.req.header('Authorization') || ''
  const token = /^Bearer\s+(.+)$/i.exec(h)?.[1] || ''
  const p = await openToken(c.env.SESSION_SECRET, token)
  if (!p || p.typ !== 'session' || !USER_RE.test(String(p.sub || ''))) return null
  return p
}
function sessionMatches(user: UserRecord, payload: Record<string, any>) {
  return !!user.session && typeof payload.sid === 'string' && timingSafeEqual(user.session.id, payload.sid)
}
async function sessionUser(c: any) {
  const p = await sessionPayload(c)
  if (!p) return null
  await applyRateLimit(c.env.PROGRESS_RATE_LIMITER, `read:user:${String(p.sub)}`)
  const row = await readUser(c.env, String(p.sub))
  return row && sessionMatches(row.user, p) ? row.user : null
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || ''
  const allowed = origin === c.env.FRONTEND_ORIGIN
  if (c.req.path.startsWith('/api/') && !allowed) return jsonError(c, 403, 'Origin not allowed.')
  if (allowed) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    c.header('Access-Control-Max-Age', '600')
  }
  c.header('Cache-Control', 'no-store, max-age=0')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  c.header('Strict-Transport-Security', 'max-age=31536000')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  if (c.req.path.startsWith('/api/')) assertConfig(c.env)
  await next()
})

app.onError((err, c) => {
  if (err instanceof AppError) return jsonError(c, err.status, err.message)
  if (err instanceof GitHubError) {
    console.error(`${SERVICE}: GitHub API failure (${err.status})`)
    return jsonError(c, 502, 'Account storage is temporarily unavailable.')
  }
  console.error(`${SERVICE}: unexpected error`, err instanceof Error ? err.name : 'unknown')
  return jsonError(c, 500, 'Unexpected server error.')
})

app.get('/health', c => {
  const problem = configProblem(c.env)
  return problem ? c.json({ ok: false, service: SERVICE, configured: false }, 503) : c.json({ ok: true, service: SERVICE })
})

app.use('/api/captcha', async (c, next) => { await authIpLimit(c, 'captcha'); await next() })
app.use('/api/register/*', async (c, next) => { await authIpLimit(c, 'register'); await next() })
app.use('/api/login/*', async (c, next) => { await authIpLimit(c, 'login'); await next() })

app.post('/api/captcha', async c => {
  await readJson(c)
  const a = randomInt(2, 9), b = randomInt(1, 9)
  const challenge = await sealToken(c.env.SESSION_SECRET, {
    typ: 'captcha', answer: a + b, ipTag: await captchaIpTag(c.env, clientIp(c)), nonce: b64url(randomBytes(12))
  }, CAPTCHA_TTL_SEC)
  return c.json({ ok: true, challenge, question: `${a} + ${b} = ?`, expiresIn: CAPTCHA_TTL_SEC })
})

app.post('/api/register/start', async c => {
  const b = await readJson(c)
  const username = String(b.username || '').trim()
  const question = String(b.securityQuestion || '').trim()
  if (b.privacyAccepted !== true) throw new AppError(400, 'Privacy acknowledgement is required.')
  const cap = await openToken(c.env.SESSION_SECRET, String(b.captchaChallenge || ''))
  const expectedIpTag = await captchaIpTag(c.env, clientIp(c))
  if (!cap || cap.typ !== 'captcha' || !timingSafeEqual(String(cap.ipTag || ''), expectedIpTag) || Number(b.captchaAnswer) !== Number(cap.answer)) throw new AppError(400, 'Human-check challenge is invalid or expired.')
  if (!USER_RE.test(username)) throw new AppError(400, 'Username must match the required six-character pattern.')
  await accountLimit(c, 'register', username)
  if (!SECURITY_QUESTIONS.has(question)) throw new AppError(400, 'Security question is invalid.')
  if (await readUser(c.env, username)) throw new AppError(409, 'That username already exists.')
  const passwordRecord = await protectClientCredential(b.passwordCredential, c.env, username, 'password')
  const answerRecord = await protectClientCredential(b.securityCredential, c.env, username, 'security-answer')
  const secret = bytesToBase32(randomBytes(20))
  const payload: TokenPayload = {
    typ: 'registration', username, question, privacyNoticeVersion: PRIVACY_NOTICE_VERSION, password: passwordRecord,
    security: { algorithm: answerRecord.algorithm, salt: answerRecord.salt, iterations: answerRecord.iterations, answerHash: answerRecord.hash, peppered: true },
    totp: await encryptTotp(c.env.DATA_ENCRYPTION_KEY, username, secret)
  }
  const challenge = await sealToken(c.env.SESSION_SECRET, payload, REGISTRATION_TTL_SEC)
  const label = encodeURIComponent(`${ISSUER}:${username}`)
  // SHA1, 6 digits, and a 30-second TOTP period are the Key URI defaults.
  // Omitting those optional defaults keeps the URI within the local version-5-L QR encoder capacity.
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}`
  return c.json({ ok: true, challenge, totpSecret: secret, otpauthUri: uri, expiresIn: REGISTRATION_TTL_SEC })
})

app.post('/api/register/finish', async c => {
  const b = await readJson(c)
  const p = await openToken(c.env.SESSION_SECRET, String(b.challenge || ''))
  if (!p || p.typ !== 'registration' || !USER_RE.test(String(p.username || ''))) throw new AppError(400, 'Registration challenge expired. Start registration again.')
  const username = String(p.username)
  await accountLimit(c, 'register-finish', username)
  if (await readUser(c.env, username)) throw new AppError(409, 'That username already exists.')
  const secret = await decryptTotp(c.env.DATA_ENCRYPTION_KEY, username, p.totp as UserRecord['totp'])
  const enrollmentCounter = await matchingTotpCounter(secret, String(b.code || ''))
  if (enrollmentCounter === null) throw new AppError(401, 'Authenticator code is incorrect or expired.')
  const now = new Date().toISOString()
  const user: UserRecord = {
    schemaVersion: 3, username, createdAt: now,
    consent: { noticeVersion: String(p.privacyNoticeVersion || PRIVACY_NOTICE_VERSION).slice(0, 40), acceptedAt: now },
    auth: p.password as CredentialHash,
    security: { question: String(p.question), ...(p.security as any) },
    totp: { ...(p.totp as UserRecord['totp']), lastUsedCounter: enrollmentCounter },
    progress: { highestUnlocked: 1, attempted: 0, correct: 0, sessions: 0, topics: Object.create(null), updatedAt: now }
  }
  try { await writeUser(c.env, user, undefined, `Create learner ${username}`) }
  catch (e) {
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) throw new AppError(409, 'That username was just created. Please log in.')
    throw e
  }
  return c.json({ ok: true, username })
})

app.post('/api/login/parameters', async c => {
  const b = await readJson(c)
  const username = String(b.username || '').trim()
  if (!USER_RE.test(username)) throw new AppError(400, 'Username format is invalid.')
  await accountLimit(c, 'login-parameters', username)
  const row = await readUser(c.env, username)
  let salt: string
  if (row && isClientCredential(row.user.auth)) salt = row.user.auth.salt
  else salt = b64url((await hmacBytes(c.env.SESSION_SECRET, `login-kdf-salt-v1\0${username}`)).slice(0, 16))
  return c.json({ ok: true, kdf: { algorithm: CLIENT_KDF_ALGORITHM, hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS, keyBytes: 32 } })
})

app.post('/api/login/password', async c => {
  const b = await readJson(c)
  const username = String(b.username || '').trim(), verifier = String(b.verifier || '')
  if (!USER_RE.test(username) || !validB64urlBytes(verifier, 32, 32)) throw new AppError(401, 'Username or password is incorrect.')
  await accountLimit(c, 'login-password', username)
  const row = await readUser(c.env, username)
  const candidateMac = await verifierMac(c.env, username, 'password', verifier)
  if (!row || !isClientCredential(row.user.auth) || !timingSafeEqual(candidateMac, row.user.auth.hash)) throw new AppError(401, 'Username or password is incorrect.')
  const challenge = await sealToken(c.env.SESSION_SECRET, {
    typ: 'login-mfa', sub: username, nonce: b64url(randomBytes(16))
  }, LOGIN_CHALLENGE_TTL_SEC)
  return c.json({ ok: true, challenge, expiresIn: LOGIN_CHALLENGE_TTL_SEC })
})

app.post('/api/login/mfa', async c => {
  const b = await readJson(c)
  const p = await openToken(c.env.SESSION_SECRET, String(b.challenge || ''))
  if (!p || p.typ !== 'login-mfa' || !USER_RE.test(String(p.sub || ''))) throw new AppError(401, 'Login challenge expired. Verify your password again.')
  const username = String(p.sub)
  await accountLimit(c, 'login-mfa', username)
  const row = await readUser(c.env, username)
  if (!row) throw new AppError(401, 'Account not found.')
  const secret = await decryptTotp(c.env.DATA_ENCRYPTION_KEY, username, row.user.totp)
  const counter = await matchingTotpCounter(secret, String(b.code || ''))
  if (counter === null) throw new AppError(401, 'Authenticator code is incorrect or expired.')
  if (Number.isInteger(row.user.totp.lastUsedCounter) && counter <= Number(row.user.totp.lastUsedCounter)) throw new AppError(401, 'That authenticator code has already been used. Wait for a new code.')
  row.user.totp.lastUsedCounter = counter
  if ((row.user.totp.version || 1) < 2) {
    const upgradedTotp = await encryptTotp(c.env.DATA_ENCRYPTION_KEY, username, secret)
    row.user.totp = { ...upgradedTotp, lastUsedCounter: counter }
  }
  row.user.schemaVersion = isClientCredential(row.user.auth) ? 3 : row.user.schemaVersion
  const sessionId = b64url(randomBytes(16))
  row.user.session = { id: sessionId, issuedAt: new Date().toISOString() }
  try { await writeUser(c.env, row.user, row.sha, 'Secure login metadata update') }
  catch (e) {
    if (e instanceof GitHubError && e.status === 409) throw new AppError(409, 'Account changed during login. Please try the new authenticator code.')
    throw e
  }
  const token = await sealToken(c.env.SESSION_SECRET, { typ: 'session', sub: username, sid: sessionId, nonce: b64url(randomBytes(16)) }, SESSION_TTL_SEC)
  return c.json({ ok: true, token, expiresIn: SESSION_TTL_SEC, user: publicUser(row.user) })
})

app.get('/api/me', async c => {
  const u = await sessionUser(c)
  return u ? c.json({ ok: true, user: publicUser(u) }) : jsonError(c, 401, 'Login required.')
})
app.get('/api/progress', async c => {
  const u = await sessionUser(c)
  return u ? c.json({ ok: true, progress: u.progress }) : jsonError(c, 401, 'Login required.')
})
app.post('/api/logout', async c => {
  await readJson(c)
  const p = await sessionPayload(c)
  if (!p) return jsonError(c, 401, 'Login required.')
  const username = String(p.sub)
  await accountLimit(c, 'logout', username)
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readUser(c.env, username)
    if (!row || !sessionMatches(row.user, p)) return c.json({ ok: true })
    delete row.user.session
    try { await writeUser(c.env, row.user, row.sha, 'Logout learner session'); return c.json({ ok: true }) }
    catch (e) { if (!(e instanceof GitHubError) || e.status !== 409 || attempt === 2) throw e }
  }
  return c.json({ ok: true })
})

function validateAttempt(raw: unknown) {
  if (!isObject(raw) || typeof raw.correct !== 'boolean') throw new AppError(400, 'Attempt data is invalid.')
  const topic = String(raw.topic || '').trim()
  if (!safeTopic(topic)) throw new AppError(400, 'Topic is invalid.')
  return { topic, correct: raw.correct }
}
function addAttempt(u: UserRecord, attempt: { topic: string; correct: boolean }) {
  if (u.progress.attempted >= MAX_COUNTER) throw new AppError(409, 'Progress counter limit reached.')
  u.progress.attempted++
  if (attempt.correct) u.progress.correct++
  let stat: TopicStat
  if (Object.prototype.hasOwnProperty.call(u.progress.topics, attempt.topic)) {
    stat = u.progress.topics[attempt.topic]
  } else {
    if (Object.keys(u.progress.topics).length >= MAX_TOPIC_COUNT) throw new AppError(409, 'Topic limit reached.')
    stat = { attempted: 0, correct: 0 }
    Object.defineProperty(u.progress.topics, attempt.topic, { value: stat, enumerable: true, writable: true, configurable: true })
  }
  if (stat.attempted >= MAX_COUNTER) throw new AppError(409, 'Topic counter limit reached.')
  stat.attempted++
  if (attempt.correct) stat.correct++
}
async function mutateUser(c: any, fn: (u: UserRecord) => void, message: string) {
  const p = await sessionPayload(c)
  if (!p) return jsonError(c, 401, 'Login required.')
  const username = String(p.sub)
  await applyRateLimit(c.env.PROGRESS_RATE_LIMITER, `progress:user:${username}`)
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readUser(c.env, username)
    if (!row) return jsonError(c, 404, 'Account not found.')
    if (!sessionMatches(row.user, p)) return jsonError(c, 401, 'Session is no longer active.')
    fn(row.user)
    row.user.progress.updatedAt = new Date().toISOString()
    try {
      await writeUser(c.env, row.user, row.sha, message)
      return c.json({ ok: true, progress: row.user.progress })
    } catch (e) {
      if (!(e instanceof GitHubError) || e.status !== 409 || attempt === 2) throw e
    }
  }
  return jsonError(c, 409, 'Progress changed concurrently. Try again.')
}

app.post('/api/progress/attempt', async c => {
  const b = await readJson(c), attempt = validateAttempt(b)
  return mutateUser(c, u => addAttempt(u, attempt), 'Record question attempt')
})
app.post('/api/progress/batch', async c => {
  const b = await readJson(c)
  if (!Array.isArray(b.attempts) || b.attempts.length < 1 || b.attempts.length > 50 || (b.sessionCompleted !== undefined && typeof b.sessionCompleted !== 'boolean')) throw new AppError(400, 'Batch progress data is invalid.')
  const attempts = b.attempts.map(validateAttempt)
  return mutateUser(c, u => {
    for (const attempt of attempts) addAttempt(u, attempt)
    if (b.sessionCompleted === true) {
      if (u.progress.sessions >= MAX_COUNTER) throw new AppError(409, 'Session counter limit reached.')
      u.progress.sessions++
    }
  }, 'Record question batch')
})
app.post('/api/progress/session', async c => {
  await readJson(c)
  return mutateUser(c, u => {
    if (u.progress.sessions >= MAX_COUNTER) throw new AppError(409, 'Session counter limit reached.')
    u.progress.sessions++
  }, 'Record completed session')
})
app.post('/api/progress/unlock', async c => {
  const b = await readJson(c)
  const completedLevel = Number(b.completedLevel), scorePct = Number(b.scorePct), questionCount = Number(b.questionCount), correctCount = Number(b.correctCount)
  if (!Number.isInteger(completedLevel) || completedLevel < 1 || completedLevel > 4 || scorePct !== 100 || !Number.isInteger(questionCount) || questionCount < 10 || questionCount > 50 || correctCount !== questionCount) throw new AppError(400, 'A perfect eligible assessment is required to unlock the next level.')
  return mutateUser(c, u => {
    if (u.progress.highestUnlocked !== completedLevel) throw new AppError(409, 'Only the currently unlocked level can unlock the next level.')
    u.progress.highestUnlocked = completedLevel + 1
  }, 'Unlock next learning level')
})

app.notFound(c => jsonError(c, 404, 'Not found.'))
export default app
