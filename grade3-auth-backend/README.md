# Grade 3 Math account backend

Small open-source backend for `https://mijicuet.github.io`.

- Runtime: Cloudflare Workers
- Framework: Hono
- Data store: private GitHub repository `mijiCUET/users-private`
- Authentication: username + password, then TOTP MFA
- Password storage: PBKDF2-HMAC-SHA-256 with a per-user random salt
- TOTP storage: AES-GCM encrypted with a Worker secret
- Sessions: signed, eight-hour bearer tokens held only in browser `sessionStorage`
- Progress: one JSON document per pseudonymous username in `users/`
- Rate limit: 12 registration/login requests per IP per minute using Cloudflare's Rate Limiting binding

No GitHub credential, TOTP encryption key, or session-signing secret is shipped to the browser.

## 1. Create the data-repository credential

### Fastest setup: fine-grained GitHub token

Create a **fine-grained personal access token** in GitHub restricted to exactly:

- Repository: `mijiCUET/users-private`
- Repository permission: **Contents — Read and write**

Do not put the token in this repository or in `index.html`. It will be stored as a Cloudflare Worker secret.

### Preferred long-term setup: GitHub App

The code also supports a GitHub App installed only on `mijiCUET/users-private`, with **Contents: Read and write**. Configure:

- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_PRIVATE_KEY`

If `GITHUB_TOKEN` is present, the simpler token path is used. Do not configure both unless intentionally using the token fallback.

> The Worker WebCrypto implementation expects a PKCS#8 private key (`-----BEGIN PRIVATE KEY-----`). If your GitHub App downloads an RSA/PKCS#1 key, convert it to PKCS#8 before adding it as the Worker secret.

## 2. Install and test locally

```bash
npm install
cp .dev.vars.example .dev.vars
# fill the development-only values in .dev.vars
npm run dev
```

Health check:

```bash
curl http://localhost:8787/health
```

Expected response:

```json
{"ok":true,"service":"grade3-math-auth"}
```

## 3. Create Cloudflare secrets

Generate two unrelated random secrets. Example:

```bash
python - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
print(secrets.token_urlsafe(48))
PY
```

Then configure the Worker:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put GITHUB_TOKEN
```

For the GitHub App route, use these instead of `GITHUB_TOKEN`:

```bash
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_PRIVATE_KEY
```

Never commit `.dev.vars`.

## 4. Deploy

```bash
npm run deploy
```

Wrangler will print the deployed Worker URL, typically similar to:

```text
https://grade3-math-auth.<your-workers-subdomain>.workers.dev
```

## 5. Connect the website

In `index.html`, find:

```html
<meta name="grade3-api-base" content="https://grade3-math-auth.YOUR-WORKERS-SUBDOMAIN.workers.dev">
```

Replace only `YOUR-WORKERS-SUBDOMAIN` with the actual Cloudflare Workers subdomain. This changes only the API-base meta tag, not the inline script or style, so the existing CSP script/style hashes do not need to be regenerated for this one substitution.

The CSP already allows HTTPS connections to `*.workers.dev`. Once you use a custom API domain, narrow `connect-src` to that exact hostname.

## 6. Optional GitHub Actions deployment

`.github/workflows/deploy.yml` is included. In the repository holding this backend source, add these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The GitHub data-store credential is **not needed by Actions**. It stays in Cloudflare Worker secrets.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/register/start` | Validate account fields and create a 10-minute TOTP enrollment challenge |
| POST | `/api/register/finish` | Verify TOTP and create `users/<username>.json` |
| POST | `/api/login/password` | Verify username/password and return a 5-minute MFA challenge |
| POST | `/api/login/mfa` | Verify TOTP and return an 8-hour session token |
| GET | `/api/me` | Return username and progress for the current session |
| GET | `/api/progress` | Return authoritative progress |
| POST | `/api/progress/attempt` | Record a completed question |
| POST | `/api/progress/session` | Record a completed session |
| POST | `/api/progress/unlock` | Unlock the next level after a 100% assessment |

## User records

The private repo gets files such as:

```text
users/
└── Ab12cd.json
```

They contain password/security-answer hashes and salts, encrypted TOTP material, and learning metrics. They do **not** contain plaintext passwords or plaintext security answers.

## Important operational note

GitHub is being used here as a small educational account store, not as a high-throughput database. Each attempt can create a repository commit. For a larger audience, batch progress updates or move progress to D1/KV while retaining the same API.
