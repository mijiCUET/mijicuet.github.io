# Security audit — Grade 3 Mathematics + `math-auth`

**Audit date:** 2026-08-08  
**Scope:** release frontend, backend, Worker configuration, GitHub storage adapter, deployment helpers, and security regression checks.  
**Service name:** `math-auth`  
**Private data repository:** `mijiCUET/users-private`

## Executive result

The release was reviewed line-by-line across the security-sensitive source and configuration (3,743 lines across `index.html`, `math-auth-backend/src/index.ts`, the backend regression checker, `wrangler.jsonc`, `package.json`, `configure_frontend.py`, and `verify_release.py`). Static security checks and a mocked end-to-end backend authentication/progress flow pass after the fixes listed below.

No review can establish that software is vulnerability-free. I did not find an open code path that allows an unauthenticated visitor to read another learner's record, modify another learner's progress, obtain the GitHub credential, recover a plaintext password, or recover a plaintext TOTP seed from the private repository alone. The residual limitations in this report remain important.

## Architecture verified

```text
mijicuet.github.io
    |
    | HTTPS JSON API
    v
Cloudflare Worker: math-auth
    |
    | GitHub App installation token (preferred)
    | or repository-scoped fine-grained PAT
    v
mijiCUET/users-private/users/<username>.json
```

Verified intended flow:

1. Practice and Test require login.
2. Login verifies username/password first.
3. The TOTP field is revealed only after password verification.
4. Successful TOTP verification creates a two-hour revocable session.
5. Logout revokes the current session in the private learner record.
6. Registration requires privacy acknowledgement + server-issued arithmetic challenge before profile creation.
7. Username pattern is exactly `[A-Z][a-z][0-9]{2}[A-Za-z]{2}`.
8. Registration presents the authenticator QR code before the manual Base32 key.
9. Progress/current level/topic metrics are stored under the authenticated server-side username.
10. Learner file paths cannot be selected by the browser; they are derived from the authenticated username.

## Findings fixed during this audit

### 1. Session lifetime validator mismatch — fixed

The backend issued two-hour session tokens while the old generic token validator effectively allowed only the short challenge lifetime. A successful login could therefore produce a token that immediately failed the next authenticated request.

**Fix:** token lifetime is now validated by purpose: CAPTCHA 15 minutes, registration 15 minutes, login-MFA challenge 5 minutes, session 2 hours.

### 2. Request-body memory/resource hardening — fixed

JSON input is now streamed and rejected once it exceeds 8 KiB, independently of a possibly misleading `Content-Length`. Invalid UTF-8 is rejected rather than silently replacement-decoded.

### 3. Sealed-token resource hardening — fixed

Encrypted challenge/session tokens are length-bounded before Base64 decoding/decryption. IV and ciphertext sizes are validated before AES-GCM is invoked.

### 4. TOTP replay — fixed

The accepted TOTP time counter is persisted in the account record. A counter already accepted for enrollment or login cannot be reused. Login accepts only the previous/current/next 30-second counter for small clock skew.

### 5. Server-side session revocation — fixed

A random current-session ID is stored in the learner record. Every authenticated read/write checks it. Logout removes it and a new login replaces it, invalidating the prior bearer token even before cryptographic expiry.

### 6. Production CORS — hardened

`/api/*` accepts only the exact configured `FRONTEND_ORIGIN`. There is no production localhost exception. Bearer authentication is used; no cross-site authentication cookie is relied on.

### 7. GitHub repository scope — hardened

The preferred GitHub App flow requests an installation token for only `GITHUB_REPO` and only `contents: write`. The Worker never returns GitHub error bodies or credentials to the browser. A fine-grained PAT remains a fallback and must be restricted to only `users-private` with Contents read/write.

### 8. Stored-record validation / prototype pollution — hardened

User records, cryptographic field sizes, topic counts, topic lengths, numeric counters, and level ranges are bounded when read from GitHub. `__proto__`, `prototype`, and `constructor` are rejected as topic keys, and topic maps use null prototypes.

### 9. Input type integrity — hardened

Progress correctness must be a real JSON boolean; values such as the string `"false"` are rejected instead of being coerced. Batch sizes and sequential level-unlock values are bounded.

### 10. Sensitive browser field lifetime — hardened

The registration password/security answer are cleared after the server creates the encrypted enrollment challenge. The QR/manual TOTP key and OTP input are cleared after account creation. The login password is cleared immediately after the password stage succeeds, and the OTP field is cleared after MFA login.

### 11. Optional real-name field in Test setup — removed

A legacy session-setup field still asked for an optional “Your name,” which conflicted with the new privacy design even though the value was only used locally. It has been removed. Practice/Test results now use only the authenticated made-up username.

### 12. Placeholder backend-origin detection — fixed

The deployment helper normalizes hostnames to lowercase. The frontend previously checked only an uppercase placeholder string, which could incorrectly treat the undeployed placeholder as a configured backend and attempt network requests to a nonexistent host. Placeholder detection is now case-insensitive and covered by the release verifier.

### 13. Privacy acknowledgement persistence — fixed

Registration already required an explicit acknowledgement, but the accepted notice version/time was not retained in the learner record. New accounts now persist a pseudonymous consent record containing only the privacy-notice version and acceptance timestamp. This does not make the notice legally sufficient by itself, but it prevents the system from losing its own acknowledgement state.

### 14. Sealed-token reserved-field precedence — hardened

The token envelope now writes `iss`, `iat`, and `exp` after the caller payload. A future route therefore cannot accidentally override cryptographic envelope metadata by supplying identically named payload properties.

### 15. Authenticated read abuse control — hardened

Authenticated `/api/me` and `/api/progress` reads now consume a per-user rate-limit bucket before performing a private GitHub repository read. This reduces the ability of one valid account to burn the repository/API quota with read-only polling.

### 16. GitHub App token-cache scoping — hardened

The in-memory GitHub App installation-token cache is keyed to the app/installation/repository scope. This avoids accidental reuse if deployment configuration changes within a reused runtime instance.

### 17. CSP and script execution — verified

The frontend has one inline script and one inline stylesheet with exact SHA-256 CSP hashes. Script policy contains neither `unsafe-inline` nor `unsafe-eval`; `connect-src` is restricted to the configured `math-auth` Worker origin. No inline HTML `on...=` attributes, `eval`, `new Function`, or `document.write` are present.

### 18. Authenticator QR payload exceeded the bundled QR encoder — fixed

The local QR renderer is intentionally dependency-free and uses QR version 5-L, whose guarded byte payload limit in this implementation is 106 bytes. The original provisioning URI explicitly included `algorithm=SHA1`, `digits=6`, and `period=30`, making the normal `Grade3Math:Ab12cd` URI 126 bytes and causing registration to fail at the QR-generation step.

**Fix:** the backend now omits those three optional parameters from the provisioning URI. Google Authenticator's Key URI format defines SHA-1, six digits, and a 30-second TOTP period as defaults, so the compact URI preserves the same TOTP behavior while fitting at 92 bytes for a normal account. The generated SVG was rendered to PNG and independently decoded during this audit; the decoded value exactly matched the expected `otpauth://` URI.

### 19. Transient authentication material on hidden views — hardened

If a learner abandoned registration after generating a TOTP seed, the hidden registration view could retain the manual seed/QR and encrypted enrollment challenge in browser memory/DOM until refresh. Likewise, an unfinished password-verified login challenge could remain in memory after navigation.

**Fix:** navigating away from Registration now clears the registration password, made-up security answer, OTP input, manual TOTP key, QR markup, and enrollment challenge. Navigating away from Login clears the password, OTP field, password-verified challenge, and MFA-stage state.

### 20. CAPTCHA endpoint body handling — hardened

The CAPTCHA endpoint previously ignored its request body, so the common 8 KiB JSON parser was not exercised on that POST route. The endpoint now parses the same required JSON object as other POST endpoints, giving it the same content-type, UTF-8, and streaming body-size protections.

### 21. Cached-browser authentication / direct-route bypass — fixed

The browser previously had enough cached token/profile state to treat a session as locally authenticated before the backend had revalidated it after a reload. In addition, direct navigation to setup-related hashes needed the same explicit gate as the visible buttons.

**Fix:** protected views now require a successful `/api/me` validation in the current page load. Direct `#setup`, `#practicePath`, and `#topicHub` routing, question launch, level opening, and the Start action all re-check authenticated state. A stale/revoked token is cleared on `401`.

### 22. Stale registration CAPTCHA/stage state — fixed

Leaving and re-entering Registration could retain transient stage state from the abandoned flow.

**Fix:** registration entry starts a fresh server CAPTCHA and resets consent/stage flags, username, password, security answer, TOTP seed/QR, enrollment challenge, and OTP state.

### 23. Cryptographic secret separation — hardened

The application uses independent secrets for session sealing, TOTP-data encryption, and password peppering. A deployment operator could still accidentally configure the same value for multiple purposes.

**Fix:** configuration validation now rejects startup when any two of `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, and `PASSWORD_PEPPER` are identical.

### 24. Public example/context passwords — hardened

A password example displayed in the UI must never itself be accepted as a good password, and context-specific service names are predictable choices.

**Fix:** the exact displayed example and a broader starter list of common values are blocked; service/context terms such as `grade3math`, `mijicuet`, and `math-auth` are also rejected. The client mirrors these checks for immediate feedback, while the server remains authoritative.

### 25. GitHub metadata validation — hardened

Repository writes depend on GitHub's returned content SHA, and GitHub App authentication depends on the returned installation token/expiry. Treating malformed upstream fields as trusted could produce confusing or unsafe state transitions.

**Fix:** file SHAs are constrained to hexadecimal Git-object-length values, and GitHub App token/expiry fields are validated before caching/use.

## Password handling

New password records use:

- Unicode NFC normalization;
- 12–128 Unicode code points;
- unique 128-bit random salt;
- HMAC-SHA-256 server-side pepper/pre-hash;
- PBKDF2-HMAC-SHA-256, 600,000 iterations;
- 256-bit derived result;
- constant-time result comparison.

The password is never written to GitHub. The release deliberately does not require an uppercase/lowercase/digit/symbol composition recipe; it supports long passphrases and rejects a built-in starter blocklist plus context-specific weak values. This follows the direction of NIST SP 800-63B, which discourages composition rules and requires screening against commonly used/expected/compromised values. The built-in list is intentionally documented as a starter list, not a substitute for a maintained compromised-password corpus. The PBKDF2 work factor follows the OWASP Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA-256.

**Reference:**
- https://pages.nist.gov/800-63-4/sp800-63b.html
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

## Security-question handling

A made-up/non-personal security answer remains because it was an explicit product requirement. It is salted/peppered and derived before storage, but it is **not used for login or account recovery**. NIST no longer recognizes security questions/KBA as an acceptable authenticator. Do not turn this field into an account-recovery factor without redesign.

**Reference:** https://pages.nist.gov/800-63-FAQ/

## TOTP handling

- 160-bit random Base32 secret.
- 6 digits, 30-second period, HMAC-SHA-1 for broad authenticator interoperability.
- AES-GCM encryption at rest with username-bound authenticated additional data.
- enrollment verification required before the user record is created.
- replay counter persisted and rejected on reuse.
- QR code is generated locally in the frontend; the secret is not sent to an online QR generator.

TOTP is MFA but is not phishing-resistant.

## Abuse controls

Configured Worker rate-limit bindings:

- broad unauthenticated IP safety limit: 60/minute;
- per-username authentication limit: 12/minute;
- per-authenticated-user progress limit: 120/minute.

Cloudflare cautions that IP-only limiting can affect legitimate users behind shared networks. This design therefore uses IP limiting only as a broad spray/resource-abuse guard and separately limits account/user identifiers. If a classroom shares one public IP and legitimate bursts are blocked, raise the broad IP limit rather than weakening the per-account limit.

The three `namespace_id` values in `wrangler.jsonc` must be unique within the Cloudflare account unless shared counters are intentional.

**Reference:** https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Dependency review

Direct versions are exact-pinned in `package.json`:

- `hono` 4.12.32
- `wrangler` 4.114.0
- `typescript` 7.0.2

These versions were current on the registry at audit time. Hono 4.12.32 is later than the 4.9.7 fix for the published body-limit middleware advisory. This backend does not rely on Hono's body-limit middleware for its 8 KiB protection; it implements its own streamed body cap.

The audit environment could not complete a trusted `npm install`/`npm audit` against the live registry, so **transitive dependency audit is a required deployment step**, not a claimed pass. Run `npm install`, `npm run verify`, and `npm audit --audit-level=moderate`, then commit the generated `package-lock.json` before production deployment.

## Cloudflare Free-plan compatibility warning

The secure password verifier intentionally performs 600,000 PBKDF2-HMAC-SHA-256 iterations. Cloudflare currently limits the Workers Free plan to **10 ms CPU per HTTP invocation**, and Cloudflare specifically notes that authentication-heavy Workers can exceed that budget. A local WebCrypto benchmark in this audit environment took roughly 116–122 ms for one 600,000-iteration PBKDF2 derivation; Cloudflare's runtime will differ, but the Free plan must not be assumed to support this work factor.

**Do not lower the password work factor merely to fit the free CPU limit.** Deploy and test login/registration while watching Worker invocation errors. If authentication hits Cloudflare Error 1102 / CPU limit, use Workers Paid (or move the backend to a runtime with an adequate CPU allowance).

**Reference:**
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/

## Verification performed

### Static release verifier

`python verify_release.py` passes all current checks, including:

- CSP script/style hash equality;
- no script `unsafe-inline`/`unsafe-eval`;
- exact `math-auth` `connect-src`;
- frontend JS syntax (`node --check`);
- no NUL bytes;
- no inline HTML event attributes;
- no `eval`, `new Function`, or `document.write`;
- service rename complete;
- 600k PBKDF2 + pepper present;
- purpose-specific session TTL validation;
- server-backed logout/revocation;
- streaming request cap;
- exact-origin CORS;
- three rate-limit bindings;
- exact-pinned Hono/Wrangler;
- every frontend API call maps to a backend route;
- no obvious live GitHub token/private key in release source;
- compact Authenticator provisioning URI is compatible with the bundled local QR capacity;
- auth-view navigation includes transient credential/TOTP cleanup;
- cached authentication must be server-validated after reload before protected views open;
- direct setup/practice/topic routes cannot bypass Login;
- registration starts with a fresh CAPTCHA/reset transient state;
- the three application cryptographic secrets must be distinct;
- the displayed password example/context terms are rejected;
- GitHub content SHAs and GitHub App token metadata are validated.

### Backend regression checker

`node math-auth-backend/scripts/security-check.mjs` passes the backend hardening assertions, including token length bounds, fatal UTF-8 parsing, TOTP replay protection, record/prototype controls, and least-privilege GitHub App token request.

### Type checking

The source passes strict TypeScript checking in the audit environment using a declaration-only local Hono API stub because the sandbox could not download npm dependencies. Production must repeat `npm run typecheck` after the real pinned dependencies are installed.

### Mocked end-to-end backend flow

A local mocked GitHub API harness passed:

- health/service name;
- hostile Origin rejection;
- server CAPTCHA;
- registration start/finish;
- encrypted learner record creation;
- enrollment TOTP replay rejection;
- password stage followed by MFA;
- two-hour session acceptance;
- strict boolean progress validation;
- prototype-key rejection;
- valid progress write;
- direct level-jump rejection;
- valid sequential unlock;
- oversized body rejection;
- logout and old-session rejection.

### Authenticator QR interoperability check

A sample production-format provisioning URI was passed through the exact frontend `qrSvg()` implementation, rendered to PNG, and decoded independently with OpenCV. The decoded URI exactly matched the original compact provisioning URI.

### Browser end-to-end limitation

Automated Chromium navigation to the local test server is blocked by the audit environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). Therefore a real-browser end-to-end pass is **not claimed**. The deployment checklist requires a fresh-browser production test after the Worker is deployed.

## Residual risks / design limitations

### A. Browser-side assessment integrity — open, important

Assessments are generated and scored in browser JavaScript. `/api/progress/unlock` checks that the requested unlock is sequential and claims 100% with an eligible question count, but the server does not independently know which questions were asked or their correct answers.

A technically capable authenticated learner can therefore forge a sequential perfect-assessment request for **their own account**. The session prevents using that request to choose another username, so this is an integrity issue rather than a cross-account authorization issue.

**Required fix for examination-grade progression:** have the backend issue a signed/server-stored assessment challenge containing question IDs/answers or independently score submitted assessment answers.

### B. JS-readable bearer token — open, architectural

The session token lives in `sessionStorage` because the static GitHub Pages frontend and `workers.dev` backend are separate sites and a same-site HttpOnly-cookie design is not straightforward/reliable here. A successful same-origin XSS could read the bearer token. The strict CSP, no third-party frontend JavaScript, output escaping, short session lifetime, and server revocation reduce this risk but do not make it equivalent to an HttpOnly cookie.

### C. GitHub repository as database — open, architectural

Git commits are not a transactional user database. Login/progress operations perform repository API reads/writes and create history. The code retries SHA conflicts and batches test attempts, but this design is intended only for small usage. Historical encrypted values also remain in Git history; protect and plan rotation of long-lived encryption/pepper keys accordingly.

### D. Human check — open, low assurance

The short-lived arithmetic challenge plus rate limiting is a simple automated-abuse speed bump, not sophisticated bot detection. It deliberately avoids third-party CAPTCHA tracking.

### E. Username enumeration during registration — open, low severity

A valid privacy/CAPTCHA registration request can learn that a pseudonymous username already exists. IP/account rate limits slow enumeration, and usernames are deliberately non-personal, but account-existence privacy is not perfect.

### F. Pseudonymous education records are still stored data — policy/legal review needed

The site avoids asking for direct identifiers, but pseudonymous usernames, authentication metadata, and educational performance are persisted. Do not claim that “nothing is collected.” Define retention/deletion procedures before public launch and obtain appropriate privacy/legal review for the intended audience and jurisdictions.

### G. Password blocklist coverage — open, operational

The server blocks a starter list of common passwords and context-specific values, but it does not ship a large maintained corpus of known-compromised passwords. Before large/public deployment, add an offline maintained blocklist of sufficient coverage. Do not send candidate passwords to a third-party breach-check service from the browser.

### H. Cloudflare rate limits are not globally exact — open, platform characteristic

Cloudflare Worker Rate Limiting bindings are local to a Cloudflare location and are permissive/eventually consistent. They are valuable abuse controls but must not be treated as a globally exact security counter. Server-side account/session checks remain authoritative.

### I. Free-plan CPU budget — deployment risk

Cloudflare Workers Free currently allows 10 ms CPU per request. The intentionally expensive 600,000-iteration password derivation may exceed that budget. Do not weaken the password verifier to fit the free tier; test real registration/login and move to Workers Paid or another adequate runtime if necessary.

### J. Clickjacking protection on GitHub Pages — open, architectural

The frontend contains best-effort frame-busting, but GitHub Pages cannot supply the preferred response-header `Content-Security-Policy: frame-ancestors ...` / `X-Frame-Options` controls for this static deployment. A `<meta>` CSP cannot enforce `frame-ancestors`. Because the application now has login and state-changing actions, stronger anti-framing protection should be added by serving the frontend from a host that can set response headers (for example Cloudflare Pages/another configurable static host) if this risk matters for the deployment.

### K. Transitive dependency audit — required before production

Direct dependencies are exact-pinned and reviewed, but the audit environment could not complete a trusted live-registry `npm install`/`npm audit`. Generate and commit `package-lock.json`, run the backend verifier/typecheck, and run `npm audit --audit-level=moderate` against the real registry before production.

## Release decision

**Code status:** suitable for controlled deployment/testing after completing the required npm audit and real Cloudflare/browser tests.  
**Not yet suitable to claim:** tamper-proof assessment progression, zero-risk security, or zero-data collection.  
**Recommended credential:** GitHub App installed only on `users-private`, minimum Contents permission, with Worker secrets stored only in Cloudflare.
