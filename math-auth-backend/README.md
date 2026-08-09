# `math-auth` backend

Small open-source authentication/progress API for **https://mijicuet.github.io**.

- Runtime: Cloudflare Workers
- Framework: Hono
- Worker/service name: `math-auth`
- Data store: private GitHub repository `mijiCUET/users-private`
- Authentication: six-character pseudonymous username + password, then TOTP MFA
- Password storage: HMAC-SHA-256 server pepper/pre-hash + PBKDF2-HMAC-SHA-256 (600,000 iterations) + per-user 128-bit salt
- TOTP storage: AES-GCM encrypted under a Worker secret, with username-bound authenticated data
- Sessions: opaque AES-GCM bearer tokens valid for two hours, plus a server-side current-session ID for revocation
- Progress: one bounded JSON record per username at `users/<username>.json`
- Abuse controls: separate Cloudflare rate-limit bindings for IP-wide auth traffic, username auth traffic, and authenticated progress/read traffic

No GitHub credential, password pepper, TOTP encryption key, or session secret is shipped to the browser.

## 1. GitHub data-repository credential

### Preferred: GitHub App

Create a GitHub App and install it **only** on `mijiCUET/users-private` with repository **Contents: Read and write**. Configure these Worker secrets:

- `GITHUB_APP_ID`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_PRIVATE_KEY`

The Worker accepts either PKCS#8 (`BEGIN PRIVATE KEY`) or RSA/PKCS#1 (`BEGIN RSA PRIVATE KEY`) PEM and converts PKCS#1 in memory. The requested installation token is narrowed again to `users-private` and `contents: write`.

### Simpler fallback: fine-grained PAT

Create a fine-grained personal access token restricted to exactly:

- Repository: `mijiCUET/users-private`
- Repository permission: **Contents — Read and write**

Store it only as the Worker secret `GITHUB_TOKEN`.

Configure **one** credential method only. The Worker refuses to start API operations if a PAT and any GitHub App credential fields are both configured.

## 2. Required secrets

Generate **three unrelated long random values** for (all three values must be different; startup validation rejects reuse):

- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`
- `PASSWORD_PEPPER`

Example:

```bash
python - <<'PY'
import secrets
for _ in range(3):
    print(secrets.token_urlsafe(48))
PY
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill only the development values. `.dev.vars` is gitignored.

For Cloudflare, store every sensitive value with `wrangler secret put` or in **Workers & Pages → math-auth → Settings → Variables and Secrets → Secret**.

## 3. Install and verify

```bash
npm install
npm run verify
npm audit --audit-level=moderate
```

Commit the generated `package-lock.json` before production deployment so transitive build dependencies are locked.

This release exact-pins its direct packages in `package.json`.

## 4. Local development

```bash
cp .dev.vars.example .dev.vars
# fill .dev.vars
npm run dev
```

Production CORS intentionally accepts only `FRONTEND_ORIGIN`. If testing the API from a local browser, use a separate local Wrangler configuration/environment rather than weakening production CORS in `src/index.ts`.

## 5. Deploy

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put PASSWORD_PEPPER
```

Then choose one GitHub credential path.

PAT:

```bash
npx wrangler secret put GITHUB_TOKEN
```

GitHub App:

```bash
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_PRIVATE_KEY
```

Deploy:

```bash
npm run deploy
```

The Worker URL will be similar to:

```text
https://math-auth.<your-workers-subdomain>.workers.dev
```

Health check:

```text
https://math-auth.<your-workers-subdomain>.workers.dev/health
```

Expected when fully configured:

```json
{"ok":true,"service":"math-auth"}
```

A `503` with `configured:false` means a required secret/binding is missing.

## 6. Connect the frontend

From the website-repository root, use the supplied helper rather than hand-editing CSP:

```bash
python configure_frontend.py https://math-auth.<your-workers-subdomain>.workers.dev index.html
python verify_release.py
```

The helper updates the API meta tag, restricts `connect-src` to the exact Worker origin, and re-pins the inline script/style hashes.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Configuration-aware health check |
| POST | `/api/captcha` | Issue a short-lived, IP-bound arithmetic human-check challenge |
| POST | `/api/register/start` | Validate acknowledgement/account fields; derive credentials; create a 15-minute TOTP enrollment challenge |
| POST | `/api/register/finish` | Verify fresh TOTP and create `users/<username>.json` |
| POST | `/api/login/password` | Verify username/password and return a 5-minute MFA challenge |
| POST | `/api/login/mfa` | Verify a fresh TOTP counter, persist current session ID, return a 2-hour session token |
| POST | `/api/logout` | Revoke the current server-side session ID |
| GET | `/api/me` | Return pseudonymous username + authoritative progress |
| GET | `/api/progress` | Return authoritative progress |
| POST | `/api/progress/attempt` | Record one completed practice question |
| POST | `/api/progress/batch` | Record up to 50 attempts and optionally one completed session |
| POST | `/api/progress/session` | Increment completed-session count |
| POST | `/api/progress/unlock` | Sequential next-level unlock after a claimed perfect eligible assessment |

## Private learner records

The private repository gets records such as:

```text
users/
└── Ab12cd.json
```

They contain:

- the pseudonymous username;
- privacy-notice acknowledgement version/time;
- salted/peppered password-derived value;
- salted/peppered made-up security-answer-derived value;
- AES-GCM encrypted TOTP material and replay counter;
- current revocable session ID metadata;
- learning progress and topic metrics.

They do **not** contain plaintext passwords or plaintext security answers.

## Important limitations

1. **Cloudflare Free CPU:** the 600,000-iteration password derivation may exceed the Workers Free 10 ms CPU budget. Do not weaken password hashing to fit the free tier; test registration/login after deployment and use Workers Paid or another adequate runtime if CPU-limit errors occur.
2. **Assessment integrity:** assessment generation/scoring is still browser-side. The server prevents cross-account and non-sequential unlocks, but a technically capable authenticated learner can forge a perfect unlock request for their own next level. See `../SECURITY_AUDIT.md`.
3. **Bearer token:** the static GitHub Pages + `workers.dev` split uses `sessionStorage` bearer auth, not a same-site HttpOnly cookie. Strict CSP and short/revocable sessions reduce—but do not eliminate—XSS token exposure.
4. **GitHub as storage:** suitable only for small/low-write usage; Git history is not a transactional database.
