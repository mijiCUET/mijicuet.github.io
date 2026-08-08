# Security assessment — mijicuet.github.io

**Scope:** the single-page Grade 3 Math practice & test application (`index.html`) and the
repository that hosts it.
**Architecture:** one self-contained static HTML file. No backend, no database, no
no backend authentication, no third-party code and no network calls. Practice now has a device-local profile gate implemented entirely in browser storage.

---

## Summary

| Area | Result |
|------|--------|
| Cross-site scripting (XSS) | **2 vulnerabilities found and fixed**, verified by fuzzing |
| Answer-integrity / type juggling | **2 logic flaws found and fixed** |
| Dangerous JS sinks (`eval`, `Function`, `document.write`) | None present |
| Secrets in repo or git history | None found (217 files, 79 commits, 91 blobs scanned) |
| Third-party dependencies | None — zero supply-chain exposure |
| Outbound network / trackers / cookies | None |
| Data storage | Device-local Practice profile + learning-path state in `localStorage`; session unlock flag in `sessionStorage`; nothing transmitted |
| Denial of service / resource abuse | Resistant (bounded generator loops) |
| Transport hardening | Applied as far as static hosting allows |

---

## 1. Cross-site scripting — FOUND AND FIXED

Two real injection points existed, both reachable through normal use.

**1.1 Stored XSS via the student name (high).**
The name typed on the setup screen was concatenated straight into `innerHTML` on the
results screen. Entering `<img src=x onerror=alert(document.cookie)>` as a name executed
attacker-controlled JavaScript.

**1.2 HTML/attribute injection via typed answers (medium).**
Typed answers were echoed unescaped into the review list and into a `value="…"` attribute,
allowing attribute break-out.

**Fixes applied**

- `esc()` — HTML-entity-encodes `& < > " ' \`` — applied to every untrusted value before it
  reaches `innerHTML`.
- `cleanName()` — strips control characters and angle brackets, caps length at 60, defaults
  to `Student`.
- `cleanNum()` — whitelists `-?digits(.digits)?` and rejects everything else, applied at
  input time and on render.

**Verification.** 14 payload families (tag injection, attribute break-out, comment escape,
`javascript:` URLs, SVG/MathML mutation-XSS, template-expression injection, exfiltration via
`fetch`) were driven through both modes, all subjects and all five levels — 52 assertions
across ~33 rendered views. No payload survives verbatim and no event handler is ever created.
The test harness includes a **positive control** that intentionally leaks, confirming the
detector genuinely catches failures rather than passing vacuously.

---

## 2. Answer-integrity flaws — FOUND AND FIXED

Discovered by logic-abuse testing rather than by inspection:

- **`parseFloat` leniency.** `parseFloat("12abc")` returns `12`, so the answer `12abc` was
  marked **correct** for a question whose answer is 12.
- **Type juggling.** `String(["cat"]) === "cat"`, so passing the array `["cat"]` satisfied a
  multiple-choice answer of `cat`.

`correct()` is now strict: it rejects non-primitives, rejects blanks, requires an exact
string match for multiple choice, and requires a fully numeric string for typed answers.

---

## 3. Dangerous sink audit

Scanned for 20 classes of risky pattern. **None present:**

`eval()` · `new Function()` · string-argument `setTimeout`/`setInterval` · `document.write` ·
`outerHTML=` · `insertAdjacentHTML` · `postMessage` · `XMLHttpRequest` · `fetch` ·
`WebSocket` · `importScripts` · `srcdoc` · `javascript:` URLs · `document.cookie` ·
`localStorage` · `sessionStorage` · `indexedDB` · location assignment from input.

Six `innerHTML` sinks exist. All are assigned locally-built template strings whose untrusted
components pass through `esc()`; the fuzzing in §1 covers every one.

> Note: an earlier version of the workbook tooling used `eval()` to evaluate generated
> arithmetic expressions. The shipped web app contains **no `eval`**, which is why the CSP
> below can omit `unsafe-eval`.

---

## 4. Secret scanning

13 credential patterns (AWS keys, GitHub/Slack/Stripe tokens, Google API keys, JWTs, private
key blocks, connection strings, generic password/API-key assignments, bearer tokens) were
scanned across:

- **217 files** in the working tree
- **79 commits** and **91 text blobs** across the *entire* git history

**Result: no secrets found.** This matters because deleted files remain recoverable in git
history — scanning only the current tree would have been insufficient.

---

## 5. Supply chain

- **Zero** external scripts, stylesheets, CDN references and package manifests.
- All fonts are system fonts; all diagrams are inline SVG drawn at runtime; the favicon is an
  inline `data:` URI.
- There is no dependency to be typosquatted, hijacked or compromised upstream, and no need
  for Subresource Integrity.

---

## 6. Privacy

- Practice deliberately asks for a **made-up** username and tells users in large text not to enter a real name, email, school ID, government ID, address, phone number, or information from legal documents.
- The username must match `^[A-Z][a-z][0-9]{2}[A-Za-z]{2}$` (example: `Ab12cd`).
- Passwords and security answers are not stored in plaintext; salted PBKDF2-HMAC-SHA-256 derived values are stored locally (120,000 iterations).
- A TOTP secret is stored locally so an authenticator app can be required. This is a **device-local profile lock, not server-backed MFA**: anyone who can inspect or modify this browser's storage can recover/bypass the local gate.
- `localStorage` contains the local profile, TOTP secret and per-profile learning-path progress. `sessionStorage` contains only the current-tab/session unlock flag.
- No cookies, analytics, tracking pixels, fingerprinting, backend requests, or profile transmission are performed.
- Because the app has no backend, account recovery across devices, centralized revocation, remote password reset and strong second-factor separation are not possible. A future real account system would require a backend and a fresh privacy/security review.

---

## 7. Resilience

| Test | Result |
|------|--------|
| 2,000-question request | satisfied in ~38 ms, no runaway loop |
| Impossible pool request (Supreme at level 1) | degrades gracefully, returns in ~4 ms |
| Hostile answers (`1e309`, `NaN`, `undefined`, `{}`, giant integers) | no exception, score still renders |
| Prototype pollution via `__proto__` | not exploitable |
| 3,000 generated geometry figures | no errors, no unbounded SVG growth |
| 48,000 generated questions across every subject × level | all well-formed and answerable |

Every generator loop is bounded by an explicit guard, so no input can cause an infinite loop.

---

## 8. Transport and browser hardening

Applied in-page:

```
Content-Security-Policy:
  default-src 'none';
  script-src 'sha256-…';      ← hash-pinned, no 'unsafe-inline', no 'unsafe-eval'
  style-src  'sha256-…';
  img-src data:;
  base-uri 'none'; form-action 'none'; frame-ancestors 'none';
  object-src 'none'; connect-src 'none';
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

The CSP is **hash-pinned**: the inline script and style are locked to their SHA-256 digests,
so injected inline script cannot execute even if an escaping bug were ever reintroduced. This
is defence in depth behind the escaping in §1.

> **If you edit `index.html`, the hashes must be recomputed**, or the browser will refuse to
> run the page. Regenerate with the snippet in "Maintaining the CSP" below.

### Known limitations of static hosting

GitHub Pages cannot send custom HTTP response headers. Therefore:

- **HSTS** cannot be set. Mitigation: enable **Settings → Pages → Enforce HTTPS**.
- **X-Frame-Options** cannot be set, and `frame-ancestors` is *ignored* in a `<meta>` CSP by
  browser design — so **clickjacking cannot be fully prevented on GitHub Pages**. The
  practical impact is low (the page has no authenticated actions, no cookies and no
  state-changing operations), but if you need it, front the site with Cloudflare or Netlify
  and set the headers there.

---

## Maintaining the CSP

After any edit to `index.html`, re-pin the hashes:

```python
import re, hashlib, base64
s = open("index.html", encoding="utf-8").read()
sha = lambda t: "'sha256-" + base64.b64encode(hashlib.sha256(t.encode()).digest()).decode() + "'"
style  = re.search(r"<style>(.*?)</style>",   s, re.S).group(1)
script = re.search(r"<script>(.*?)</script>", s, re.S).group(1)
csp = ("default-src 'none'; script-src " + sha(script) + "; style-src " + sha(style) + "; "
       "img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; "
       "object-src 'none'; connect-src 'none'")
s = re.sub(r'(Content-Security-Policy" content=")[^"]+(")', lambda m: m.group(1)+csp+m.group(2), s)
open("index.html", "w", encoding="utf-8", newline="\n").write(s)
```

---

## Residual risk

| Risk | Severity | Status |
|------|----------|--------|
| Clickjacking via iframe embedding | Low | Cannot be fixed on GitHub Pages; no sensitive actions exist |
| Repo compromise via a stolen GitHub account | Medium | Outside the app — enable 2FA and use a passkey |
| Browser 0-day in SVG/HTML rendering | Low | Out of scope; no third-party content is rendered |

**No open vulnerabilities in the application itself.**

---

*Assessment covers the application as committed. Re-run the test suite after any change to
the rendering or scoring code.*
