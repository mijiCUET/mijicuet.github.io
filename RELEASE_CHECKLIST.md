# Final release checklist — Grade 3 Mathematics + `math-auth`

**Release date:** 2026-08-08  
**Worker/service:** `math-auth`  
**Frontend:** `https://mijicuet.github.io`  
**Private data repository:** `mijiCUET/users-private`

## Completed in this release

- [x] Renamed Worker/service/backend references to `math-auth`.
- [x] Practice and Take a Test force the fresh Login flow.
- [x] Login is two-stage: username/password, then TOTP MFA.
- [x] Registration is staged: privacy acknowledgement → server CAPTCHA → username → password/passphrase → made-up security answer → local QR/manual TOTP key → code verification.
- [x] Pseudonymous username format is exactly `^[A-Z][a-z][0-9]{2}[A-Za-z]{2}$`.
- [x] Logged-in header shows username + Logout; logged-out header shows Login + Create account.
- [x] Dashboard uses authoritative server progress: current level, attempted, correct, accuracy, sessions, topic metrics.
- [x] Level topic pages are discovered from all eligible generators, not a short UI list.
- [x] 166 generators / 75 total domain labels audited; no eligible generator failed the sampling sweep.
- [x] Passwords/security answers are derived, not stored in plaintext.
- [x] TOTP seed is AES-GCM encrypted at rest; replay counters are persisted.
- [x] Sessions are two-hour opaque bearer tokens plus server-side current-session IDs for revocation.
- [x] Request body, token, user-record, topic, batch, and counter sizes are bounded.
- [x] Production CORS is exact-origin.
- [x] IP/account/progress rate-limit bindings are required.
- [x] GitHub App access is narrowed to the private data repo and Contents permission; fine-grained PAT is a fallback.
- [x] CSP hashes match final frontend script/style.
- [x] No legacy service/backend names remain in release candidates.

## Final automated checks run

- [x] `python verify_release.py` — PASS.
- [x] `node math-auth-backend/scripts/security-check.mjs` — PASS.
- [x] Frontend JavaScript `node --check` — PASS through release verifier.
- [x] Strict TypeScript source check with a declaration-only local Hono stub — PASS.
- [x] `configure_frontend.py` tested on a temporary `math-auth.*.workers.dev` origin; CSP repinning re-verified — PASS.
- [x] Live-looking credential/private-key-body scan of release source — PASS (documented PEM parser/example delimiters are not credentials).
- [x] Dangerous dynamic-code/scheme scan (`eval`, `new Function`, `document.write`, `javascript:`) — PASS.
- [x] Generator eligibility/domain audit — PASS: 166 generators, 75 global topic domains, zero failed eligible generators in the sampling sweep.
- [x] Authenticator provisioning QR interoperability was previously rendered and independently decoded using the exact local QR implementation; compact URI matched exactly.
- [x] Mocked backend registration/login/TOTP/session/progress/logout flow passed during this audit cycle; current backend source has not changed since that flow test.

## Required before production launch

- [ ] Deploy `math-auth` and add **three different** Worker secrets: `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `PASSWORD_PEPPER`.
- [ ] Configure exactly one GitHub credential method, preferably a GitHub App installed only on `mijiCUET/users-private`.
- [ ] Run `npm install`, `npm run verify`, and `npm audit --audit-level=moderate` against the real npm registry; commit the generated `package-lock.json`.
- [ ] Test registration/login on the actual Cloudflare runtime. Workers Free has a small CPU budget and may not accommodate the intentionally expensive password derivation.
- [ ] Run the full Incognito/Private-browser checklist in `DEPLOY_BACKEND.md`.
- [ ] Define account/data retention and deletion procedures and obtain appropriate privacy/legal review before a public child-directed launch.

## Known residual risks

The release must **not** be described as vulnerability-free. In particular:

1. Assessment questions/scoring are still browser-side. A technically capable authenticated learner can forge their **own** next sequential perfect-score unlock. Server-issued/signed or server-scored assessments are needed for tamper-proof progression.
2. The cross-site GitHub Pages → Workers design uses a JS-readable bearer token in `sessionStorage`; same-origin XSS could steal it. Strict CSP/no third-party scripts/escaping/revocation reduce this risk but are not equivalent to a same-site HttpOnly cookie.
3. GitHub repository storage is suitable only for small/low-write use and keeps history; it is not a transactional database.
4. The built-in password blocklist is a starter list, not a maintained breached-password corpus.
5. Cloudflare Worker Rate Limiting is per-location and permissive/eventually consistent, not a globally exact throttle.
6. GitHub Pages cannot supply the preferred response-header anti-framing policy; frontend frame-busting is best-effort.
7. Transitive dependency audit and real production browser/runtime testing remain deployment prerequisites.

See `SECURITY_AUDIT.md` for the detailed findings, fixes, verification scope, and rationale.
