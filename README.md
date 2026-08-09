# Grade 3 Mathematics — Practice & Test

Live frontend: **https://mijicuet.github.io**

This repository contains a browser-generated Grade 3 mathematics practice/test application plus the small `math-auth` backend used for pseudonymous accounts and learning progress.

## User experience

Logged out, the masthead shows **Home**, **Login**, and **New user? Create account**. Clicking either **Practice** or **Take a Test** requires a fresh login: username/password are verified first; only then is the TOTP authenticator field shown.

Registration is staged:

1. privacy acknowledgement stating not to enter real/legal personal information;
2. server-backed arithmetic human check;
3. six-character pseudonymous username: uppercase, lowercase, two digits, two letters (example format `Ab12cd`);
4. passphrase/password;
5. invented/non-personal security-question answer;
6. authenticator QR code, then manual key, then verification code.

No email address or real/legal name is requested.

After login, the learner sees the pseudonymous username, Logout, current unlocked level, questions attempted, correct answers, overall accuracy, session count, and per-topic performance.

## Learning path

Five levels:

**Beginner → Developing → Intermediate → Advanced → Supreme**

Only Beginner starts unlocked. Each level's topic dashboard is derived directly from the generators eligible at that level rather than from a separate short hard-coded topic list. The engine includes arithmetic, number sense, money, measurement, time/data, fractions, geometry, perimeter/area, patterns, odd/even, comparisons, and progressively harder/Supreme domains.

At the end of each level, a 100% assessment can request the next sequential level unlock. See the integrity limitation in `SECURITY_AUDIT.md`: browser-side assessment scoring is not tamper-proof against a learner deliberately modifying requests.

## Architecture

```text
GitHub Pages: mijicuet.github.io
        |
        | HTTPS JSON
        v
Cloudflare Worker: math-auth
        |
        | least-privilege server credential
        v
Private repo: mijiCUET/users-private
```

The private repo stores one pseudonymous JSON account record per username. Plaintext passwords and security answers are not stored. TOTP seeds are encrypted at rest; progress is persisted server-side.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Complete static math frontend/question engine |
| `math-auth-backend/` | Hono + Cloudflare Worker backend |
| `configure_frontend.py` | Safely set the deployed Worker origin and re-pin CSP |
| `verify_release.py` | Release/static security checks |
| `DEPLOY_BACKEND.md` | Step-by-step deployment |
| `SECURITY.md` | Frontend/backend security overview |
| `SECURITY_AUDIT.md` | Detailed 2026-08-08 audit, fixes, tests, residual risks |
| `GENERATOR_COVERAGE.md` | Generator/topic coverage audit by level |

## Security-sensitive deployment

The distributed `index.html` intentionally contains the placeholder:

```text
https://math-auth.your-workers-subdomain.workers.dev
```

That safe default prevents accidental API use before deployment. After Cloudflare gives you the real Worker origin, run:

```bash
python configure_frontend.py https://math-auth.<your-workers-subdomain>.workers.dev index.html
python verify_release.py
```

Do not manually paste GitHub credentials or Worker secrets into the HTML.

See `DEPLOY_BACKEND.md` for the full process.
