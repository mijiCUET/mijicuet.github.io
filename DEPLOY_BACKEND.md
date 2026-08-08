# Finish deployment: Grade 3 Math accounts

The code is complete, but two external resources still have to be configured by the repository/account owner: a Cloudflare Worker deployment and a GitHub credential that can write only to `mijiCUET/users-private`.

## A. Put the backend source in GitHub

Recommended: create a separate repository named `grade3-auth-backend` and copy the contents of the supplied `grade3-auth-backend/` directory into it.

Do **not** put learner JSON records in that source repository. Learner records are written automatically to:

```text
mijiCUET/users-private/users/<username>.json
```

## B. Give the Worker private-repo access

Quick path: create a GitHub fine-grained token restricted to only `mijiCUET/users-private` with **Contents: Read and write**.

Do not paste that token into `index.html`, a GitHub commit, or this chat.

The backend also supports a GitHub App if you prefer that after initial deployment.

## C. Deploy the Worker

From the backend directory:

```bash
npm install
npx wrangler login

npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put GITHUB_TOKEN

npm run deploy
```

Use two different long random values for `SESSION_SECRET` and `DATA_ENCRYPTION_KEY`.

Wrangler will return a URL similar to:

```text
https://grade3-math-auth.<your-workers-subdomain>.workers.dev
```

Check it:

```bash
curl https://grade3-math-auth.<your-workers-subdomain>.workers.dev/health
```

Expected:

```json
{"ok":true,"service":"grade3-math-auth"}
```

## D. Point the website to the Worker

In the supplied `index.html`, replace:

```html
<meta name="grade3-api-base" content="https://grade3-math-auth.YOUR-WORKERS-SUBDOMAIN.workers.dev">
```

with the real Worker URL.

No JavaScript or CSS changes are needed for that substitution, so the already pinned CSP script/style hashes remain valid.

Then commit/push the updated `index.html` to the GitHub Pages repository.

## E. Test the full path

1. Open the GitHub Pages site in a fresh browser session.
2. Click **New user? Create account**.
3. Accept the non-PII notice and pass the local CAPTCHA.
4. Create a username matching the six-character pattern.
5. Set a password and made-up security answer.
6. Scan the QR code in an authenticator app and submit its current code.
7. Confirm a new file appears in `users-private/users/`.
8. Log in with username/password, then TOTP.
9. Complete practice questions.
10. Confirm the dashboard updates and the private JSON record receives progress updates.
11. Complete a level assessment with 100% and confirm the next level unlocks server-side.

## F. Before public launch

- Keep `users-private` private.
- Keep every Worker/GitHub secret out of Git.
- Enable GitHub account 2FA/passkey for repository administrators.
- Review the child/privacy policy wording before public launch because persistent pseudonymous learner accounts and performance records are now stored server-side.
