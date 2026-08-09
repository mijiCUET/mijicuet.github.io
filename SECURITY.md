# Security overview — Grade 3 Mathematics + `math-auth`

## Current architecture

The current release is **not** the older “nothing leaves the browser” design. It intentionally persists pseudonymous account and educational-performance data:

```text
Browser on mijicuet.github.io
        |
        | HTTPS API
        v
math-auth Cloudflare Worker
        |
        v
private mijiCUET/users-private repository
```

The site asks users not to provide a real/legal name, email, phone, address, school ID, government ID, or legal-document information. Nevertheless, pseudonymous usernames and learning records are stored data and must be treated accordingly.

## Frontend protections

- one self-contained HTML file; no third-party frontend scripts;
- hash-pinned CSP for the exact inline script/style;
- `connect-src` narrowed to the exact configured `math-auth` origin;
- no `unsafe-eval` or script `unsafe-inline` exemption;
- no inline HTML event attributes;
- no `eval`, `new Function`, or `document.write`;
- untrusted display values use text nodes or escaping;
- TOTP QR is rendered locally from the enrollment URI, not sent to an online QR service;
- bearer session is kept in `sessionStorage`, not persistent `localStorage`;
- best-effort anti-framing script because static GitHub Pages cannot supply all desired response headers.

## Backend protections

- exact-origin production CORS;
- JSON request streaming hard cap (8 KiB);
- required Cloudflare IP/account/progress rate-limit bindings;
- password PBKDF2-HMAC-SHA-256 at 600,000 iterations, per-user random salt, server-only pepper;
- TOTP seed AES-GCM encryption and replay-counter rejection;
- purpose-specific opaque AES-GCM challenges/session tokens;
- two-hour sessions linked to a server-side current-session ID;
- Logout revokes the current session server-side; a new login invalidates the prior session;
- generic external-storage error messages;
- strict GitHub path construction from six-character usernames;
- bounded/validated user records, counters and topics;
- prototype-pollution topic keys rejected;
- GitHub App access token request constrained to the private data repo and Contents write.

**Runtime note:** the 600,000-iteration PBKDF2 verifier is intentionally expensive. Cloudflare Workers Free has a 10 ms CPU-per-request limit, so secure registration/login may require Workers Paid (or another backend runtime). Do not weaken the password work factor merely to satisfy a free-tier CPU cap.

## No plaintext credentials in the data repo

`users/<username>.json` contains derived password/security-answer data and encrypted TOTP material, not plaintext passwords or plaintext security answers.

## Security question caveat

A non-personal invented security question was requested and remains in registration. It is **not used as a login or recovery authenticator**. Security questions/KBA should not become the basis for account recovery without redesign.

## Remaining risks

The release is hardened but no code review can prove the absence of all vulnerabilities. Known design limitations are documented in `SECURITY_AUDIT.md`, especially:

- browser-generated/scored assessments are not tamper-proof for a learner's own progression;
- the JS-readable bearer token has more XSS exposure than a same-site HttpOnly cookie;
- GitHub is suitable only as a small/low-write account store;
- the arithmetic human check is a rate-limit supplement, not advanced bot detection;
- persistent pseudonymous educational data creates privacy/retention responsibilities even though direct identifiers are discouraged;
- the built-in password blocklist is a starter list, not a maintained breached-password corpus;
- Cloudflare Worker rate limits are per-location/eventually consistent and are not an exact global throttle;
- GitHub Pages cannot send the preferred anti-framing response headers, so clickjacking defense is only best-effort until the frontend is served from a host that can set them.

## Secrets

Never commit:

- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`
- `PASSWORD_PEPPER`
- `GITHUB_TOKEN`
- `GITHUB_PRIVATE_KEY`
- Cloudflare API credentials

See `math-auth-backend/SECURITY.md` for rotation behavior.
