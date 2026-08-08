# Backend security notes

## Secrets

Never commit any of these values:

- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`
- `GITHUB_TOKEN`
- `GITHUB_PRIVATE_KEY`
- Cloudflare API tokens

They belong in Cloudflare Worker secrets (or local `.dev.vars`, which is ignored by Git).

## Passwords

The backend never writes plaintext passwords to GitHub. Passwords are derived with PBKDF2-HMAC-SHA-256 using 240,000 iterations and a random 128-bit salt per account.

## Security-question answers

Answers are normalized to lowercase and stored only as salted PBKDF2-derived values. The frontend deliberately asks for invented answers, not real-life facts.

## TOTP

The authenticator seed must be recoverable to verify future codes, so it cannot be hashed. It is encrypted with AES-GCM using `DATA_ENCRYPTION_KEY`. The encryption key is a Worker secret and is not stored in GitHub.

## Sessions

Successful password + TOTP login returns a signed session token valid for eight hours. The browser stores it in `sessionStorage`, so closing the tab/window session removes it. This avoids third-party-cookie problems between GitHub Pages and `workers.dev`, but it means JavaScript can access the token. The page therefore retains a strict hash-pinned CSP and no third-party scripts.

A same-site custom domain can later move sessions to Secure/HttpOnly cookies.

## CORS

Production requests are accepted only from the configured `FRONTEND_ORIGIN`, currently `https://mijicuet.github.io`. Localhost is allowed for development.

## Rate limiting

Registration and login endpoints use the Cloudflare Workers Rate Limiting binding. The included default is 12 requests per IP per 60 seconds.

## Repository access

Prefer a GitHub App installed only on `mijiCUET/users-private` with Contents read/write. The fine-grained PAT fallback should also be restricted to that single repository and only Contents read/write.

## Data minimization

The application deliberately does not request names, email addresses, telephone numbers, addresses, school IDs, or government-document information. It stores a six-character pseudonymous username, credential-derived values, encrypted authenticator material, and learning progress.
