# `math-auth` backend security notes

The detailed release audit is in `../SECURITY_AUDIT.md`.

## Secrets

Never commit or expose:

- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`
- `PASSWORD_PEPPER`
- `GITHUB_TOKEN`
- `GITHUB_PRIVATE_KEY`
- Cloudflare deployment/API credentials

Use Cloudflare Worker **Secrets** in production and gitignored `.dev.vars` only for local development.

Three cryptographic application secrets are intentionally separate so compromise/rotation domains are not needlessly coupled. Startup validation rejects a deployment if any two of `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, and `PASSWORD_PEPPER` are identical.

## Passwords

New password records use:

- Unicode NFC normalization;
- 12–128 Unicode code points;
- rejection of control characters, username-containing passwords, a built-in starter blocklist of common values, and service/context-specific weak values;
- unique 128-bit random salt;
- HMAC-SHA-256 with server-only `PASSWORD_PEPPER` as a pre-hash/domain separator;
- PBKDF2-HMAC-SHA-256 at **600,000 iterations**;
- 256-bit derived output;
- constant-time comparison of fixed-size derived values.

Plaintext passwords are never written to GitHub. The built-in blocklist is a starter safeguard, not a maintained breached-password corpus; for a larger public deployment, add a maintained offline compromised-password blocklist without transmitting candidate passwords to a third party. Legacy unpeppered/lower-work-factor records can be upgraded only after successful password + TOTP login.

**Operational warning:** this work factor can exceed Cloudflare Workers Free's CPU budget. Do not lower it merely to fit a free tier.

## Security-question answers

The product requirement keeps a made-up, non-personal security question. Its answer is normalized and stored only as salted/peppered PBKDF2-derived data. It is **not used for login or account recovery**. Do not promote it to an authentication/recovery factor without redesign.

## TOTP

- 160-bit random Base32 secret.
- TOTP parameters: HMAC-SHA-1, 6 digits, 30-second period for broad authenticator compatibility. The provisioning URI omits those optional parameters because they are Authenticator defaults; this keeps the local QR payload within the bundled encoder capacity.
- Seed encrypted at rest with AES-GCM under `DATA_ENCRYPTION_KEY`.
- Version-2 encryption binds ciphertext to the pseudonymous username with AES-GCM authenticated additional data.
- Registration requires a valid TOTP before the learner record is created.
- The accepted TOTP counter is persisted; the same or older counter is rejected on subsequent login.
- The frontend generates the QR locally and shows the manual key directly below it; no online QR service receives the seed.

TOTP provides MFA but is not phishing-resistant.

## Sessions

Successful password + TOTP verification returns an opaque AES-GCM session token valid for **two hours**. The token includes a random server-side session ID; the same ID is stored in the private learner record and checked on every authenticated read/write.

- a new login replaces the stored session ID and invalidates the previous session;
- logout deletes the stored session ID;
- the browser keeps the bearer token only in `sessionStorage`, not persistent `localStorage`.

Because GitHub Pages and `workers.dev` are separate sites, this release does not claim the stronger XSS isolation of a same-site `Secure; HttpOnly` cookie. A future same-site custom-domain architecture should prefer HttpOnly cookies.

## CORS / request handling

- Production `/api/*` accepts only the exact configured `FRONTEND_ORIGIN`.
- There is no production localhost exception.
- API JSON bodies require `Content-Type: application/json`.
- Bodies are streamed and hard-capped at 8 KiB regardless of `Content-Length` claims.
- Invalid UTF-8 and non-object JSON are rejected.
- API responses use `Cache-Control: no-store` and defensive security headers.

Bearer authentication plus exact-origin CORS means the API does not rely on ambient cross-site cookies for authentication.

## Rate limiting

Three Cloudflare Rate Limiting bindings are required by configuration:

- `AUTH_IP_RATE_LIMITER`: 60/minute broad unauthenticated spray/resource guard;
- `AUTH_ACCOUNT_RATE_LIMITER`: 12/minute per pseudonymous username for registration/login/logout stages;
- `PROGRESS_RATE_LIMITER`: 120/minute per authenticated username for profile/progress reads and writes.

The IP bucket is intentionally broader because classrooms/mobile networks can share an IP. The `namespace_id` values in `wrangler.jsonc` must be unique within the Cloudflare account unless shared counters are intentional. Cloudflare Worker rate-limit counters are local to a Cloudflare location and permissive/eventually consistent, so these bindings are abuse controls rather than an exact global accounting mechanism.

## GitHub access

Preferred: a GitHub App installed only on `mijiCUET/users-private` with Contents read/write. The Worker requests installation tokens constrained to:

- repository: `users-private`;
- permission: `contents: write` (which includes the reads needed by the Contents API).

The in-memory installation-token cache is keyed to app/installation/repository scope and refreshes before expiration.

Fallback: a fine-grained PAT restricted to that same repository and Contents read/write. Never use a classic broad `repo` token for this deployment.

## Stored-record validation

Learner filenames are derived only from the server-authenticated six-character username. Stored records are normalized/bounded before use:

- user-record maximum 128 KiB;
- up to 160 topic keys, each up to 96 code points;
- numeric counters capped;
- current level clamped to 1–5;
- cryptographic salt/hash/IV/ciphertext byte lengths validated;
- `__proto__`, `prototype`, and `constructor` rejected as topic keys;
- topic maps use null prototypes internally.

## Error handling / logging

GitHub response bodies and credentials are never returned to the browser. Expected application errors are concise. Unexpected errors log only an error class/name rather than request bodies, passwords, bearer tokens, TOTP codes, or GitHub response payloads.

## Residual limitations

See `../SECURITY_AUDIT.md`, especially:

- browser-side assessment scoring is not tamper-proof for a learner's own next-level unlock;
- a same-origin XSS could read the `sessionStorage` bearer token;
- Git history retains historical encrypted records and is not transactional storage;
- the arithmetic human check is only a lightweight bot-abuse speed bump;
- pseudonymous educational progress is still stored data and needs a retention/deletion/privacy policy;
- the built-in password blocklist is not a maintained breached-password corpus;
- Cloudflare Worker rate limits are per-location/eventually consistent rather than an absolute global throttle;
- GitHub Pages cannot provide the preferred response-header anti-framing policy; the frontend frame-busting script is best-effort.
