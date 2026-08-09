# Deploy `math-auth` for Grade 3 Mathematics

This release uses:

```text
mijicuet.github.io                 public GitHub Pages frontend
        |
        v
Cloudflare Worker: math-auth      authentication + progress API
        |
        v
mijiCUET/users-private            private pseudonymous account records
```

## 1. Add the backend source to GitHub

Because Cloudflare is already connected to `mijiCUET/mijicuet.github.io`, the simplest layout is:

```text
mijicuet.github.io/
├── index.html
├── README.md
├── SECURITY.md
├── configure_frontend.py
└── math-auth-backend/
    ├── package.json
    ├── wrangler.jsonc
    ├── src/index.ts
    └── ...
```

Copy the supplied `math-auth-backend/` directory into the website repository and commit it.

Do **not** put learner JSON records there. The Worker writes them only to:

```text
mijiCUET/users-private/users/<username>.json
```

## 2. Ensure the private data repo is ready

`mijiCUET/users-private` must be private and have a `main` branch. If it is empty, create/commit a README first.

## 3. Create the least-privilege GitHub credential

### Preferred: GitHub App

Create/install a GitHub App only on `mijiCUET/users-private` with repository **Contents: Read and write**. Keep:

- App ID
- Installation ID
- downloaded private key

The Worker further requests installation tokens for only `users-private` and only Contents write.

### Simpler fallback: fine-grained PAT

Create a fine-grained token with:

```text
Resource owner: mijiCUET
Repository access: only users-private
Repository permission: Contents — Read and write
```

Never paste the token/private key into `index.html`, Git commits, screenshots, or chat.

## 4. Create the Worker from the connected GitHub repository

In Cloudflare:

**Workers & Pages → Create → Import a repository → `mijiCUET/mijicuet.github.io`**

Use:

```text
Worker name:       math-auth
Production branch: the branch you actually deploy from
Root directory:   math-auth-backend
Deploy command:   npx wrangler deploy
```

`wrangler.jsonc` already names the Worker `math-auth`.

The rate-limit namespace IDs `1001`, `1002`, `1003` must be positive integer strings unique to the intended rate-limit state in your Cloudflare account. If you already use those IDs elsewhere and do not want counters shared, choose unused positive integers.

## 5. Add Worker secrets

Generate three unrelated random values. **All three values must be different**; the Worker rejects a configuration that reuses one cryptographic secret for multiple purposes:

```bash
python - <<'PY'
import secrets
for _ in range(3):
    print(secrets.token_urlsafe(48))
PY
```

In Cloudflare **math-auth → Settings → Variables and Secrets**, add as **Secret**:

```text
SESSION_SECRET
DATA_ENCRYPTION_KEY
PASSWORD_PEPPER
```

Then add exactly one GitHub credential method.

Fine-grained token:

```text
GITHUB_TOKEN
```

or GitHub App:

```text
GITHUB_APP_ID
GITHUB_INSTALLATION_ID
GITHUB_PRIVATE_KEY
```

Do not configure both methods simultaneously; the Worker deliberately refuses ambiguous credential configuration.

The normal non-secret variables are already in `wrangler.jsonc`:

```text
FRONTEND_ORIGIN = https://mijicuet.github.io
GITHUB_OWNER     = mijiCUET
GITHUB_REPO      = users-private
GITHUB_BRANCH    = main
```


## Important: Free-plan CPU test

The backend intentionally uses 600,000-iteration PBKDF2-HMAC-SHA-256 for password derivation. Cloudflare Workers Free currently has a 10 ms CPU-per-request limit. Strong password derivation may exceed that limit. **Do not reduce the work factor to make it fit.**

Deploy first and test registration/login while watching Cloudflare invocation errors. If authentication produces CPU-limit / Error 1102 failures, move this Worker to Workers Paid (or another backend runtime with an adequate CPU budget). The `/health` endpoint alone does not exercise password hashing and therefore cannot prove that the free CPU budget is sufficient.

## 6. Verify the Worker

After deployment Cloudflare gives an origin similar to:

```text
https://math-auth.<your-workers-subdomain>.workers.dev
```

Open:

```text
https://math-auth.<your-workers-subdomain>.workers.dev/health
```

Expected:

```json
{"ok":true,"service":"math-auth"}
```

A `503` with `configured:false` means one or more required secrets/bindings are missing.

## 7. Configure the frontend safely

Do not hand-edit the CSP. From the website-repository root run:

```bash
python configure_frontend.py https://math-auth.<your-workers-subdomain>.workers.dev index.html
```

The helper validates the origin, updates `grade3-api-base`, narrows `connect-src` to that exact Worker origin, and recomputes the inline script/style CSP hashes.

Then run:

```bash
python verify_release.py
```

Commit/push the configured `index.html`.

## 8. First production test

Use an Incognito/Private browser window.

1. Homepage must show **Home**, **Login**, and **New user? Create account** while logged out.
2. Click **Practice**. It must open Login.
3. Click **New user? Create account**.
4. Check the privacy acknowledgement and solve the server-backed arithmetic human check.
5. Verify invalid username formats do not open the password stage; `Ab12cd`-format usernames do.
6. Create a long passphrase and a made-up/non-personal security answer.
7. Generate Authenticator setup. The QR code must appear first, with the manual Base32 key directly beneath it.
8. Verify a TOTP code and create the account.
9. Confirm `users-private/users/<username>.json` appears and does **not** contain plaintext password or security answer.
10. Login: username/password first; TOTP stage must remain hidden until credentials pass.
11. After MFA, the header must display the pseudonymous username and Logout.
12. Answer Practice/Test questions and confirm the dashboard and private JSON progress update.
13. Reload while logged in and confirm the app revalidates the bearer session with `/api/me` before showing protected content.
14. Manually try `#setup`, `#practicePath`, and `#topicHub` while logged out; each protected path must return to Login instead of opening content.
15. Logout; then confirm the old session no longer works by reloading/navigating back.
16. Earn a true 100% assessment through the UI and confirm only the next sequential level unlocks.

## 9. Dependency verification before public launch

This package exact-pins its direct package versions. On your machine, run:

```bash
cd math-auth-backend
npm install
npm run verify
npm audit --audit-level=moderate
```

Commit the generated `package-lock.json`. Do this before production deployment so transitive build-tool dependencies are locked as well.

## 10. Important limitation

The server protects account ownership and requires sequential unlocks, but assessment questions and scoring are currently performed in browser JavaScript. A technically capable authenticated learner can forge *their own* sequential `100%` unlock request. They cannot use that to modify another username, but perfect-score unlocks are not tamper-proof until assessments are generated/signed or scored server-side.

Do not represent the current progression gate as an examination-grade integrity system.
