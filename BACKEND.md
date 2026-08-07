# Accounts, OTP and what still needs a server

## Read this first

The site is hosted on **GitHub Pages**, which serves files and nothing else. It cannot run
code on a server, so it **cannot send an email**. That single fact shapes everything below.

What the page *does* do, entirely in the browser and exactly as specified:

| Step | Status |
|------|--------|
| Generate a random 6-digit code (`crypto.getRandomValues`, not `Math.random`) | ✅ done |
| Store it as a SHA-256 hash — the plain code is never kept | ✅ done |
| Hold it for **120 seconds**, then discard it | ✅ done |
| Single use — destroyed the moment it is accepted | ✅ done |
| Lock after 5 wrong attempts; 30-second resend cool-down | ✅ done |
| **Put that code in the visitor's inbox** | ❌ **needs a server** |

Right now the code is displayed on screen (clearly labelled *Demo mode*) so the whole flow
can be walked through end to end. Everything else is real.

---

## The honest limits of the current build

Please do not launch this to real children before reading this section.

1. **The guest gate is a courtesy, not a lock.** "One free session" is a flag in
   `localStorage`. Private browsing, a different browser, or clearing site data resets it.
   Only a server that knows who has already played can enforce this.
2. **Accounts live in one browser.** Register on a laptop and the account does not exist on
   a phone. There is no shared database yet.
3. **Passwords are hashed properly (PBKDF2, 150 000 iterations, per-user salt) but stored
   locally.** That is good practice, not a safe place for real credentials.
4. **The code is public.** Anything in `index.html` can be read by anyone. Never paste a
   secret key, SMTP password or service token into it.

---

## Wiring up a real backend

The whole integration is **one function**. Replace `MAIL.send()` near the top of the script
and fill in `AUTH_CFG`. Nothing else changes.

### Option A — Supabase (recommended, free tier)

Supabase sends the verification email for you and stores accounts in Postgres.

1. Create a project at supabase.com.
2. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
   Both are safe to publish — row-level security is what protects the data, not secrecy.
3. In `index.html`, find `AUTH_CFG` and fill in:

```js
const AUTH_CFG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseKey: "YOUR-ANON-PUBLIC-KEY",
  ...
};
```

4. Update the CSP so the page may talk to Supabase — find the
   `Content-Security-Policy` meta tag and change:

```
connect-src 'none'
```
to
```
connect-src https://YOUR-PROJECT.supabase.co
```

5. Re-pin the CSP hashes (the snippet is in `SECURITY.md` — the script changed, so the old
   hash no longer matches and the page will refuse to run until you do this).
6. In Supabase, enable **Auth → Email OTP**, and create a `profiles` table for the
   registration fields with row-level security on.

The code already detects this: when both config values are present, `AUTH_MODE` flips to
`"supabase"` and `MAIL.send()` calls the real OTP endpoint instead of revealing the code.

### Option B — a small serverless function

If you would rather keep the OTP logic yourself, deploy a tiny function (Cloudflare Workers,
Vercel, Netlify — all have free tiers) that holds the secret API key for a mail service such
as Resend, Postmark or SendGrid, and expose one endpoint:

```
POST /api/send-otp   { email, code }   →   { ok: true }
```

Then point `MAIL.send()` at it. **Keep the OTP store on the server**, not in the browser, or
a determined child can simply read the expected value out of memory.

### Not recommended

Client-side email services (EmailJS and similar) do work without a server, but the sending
key sits in your public HTML, so anyone can use your quota to send mail. Avoid for a site
aimed at children.

---

## Before you collect data from children — please take this seriously

Registration asks for a child's **name, age, email, phone number and a parent's details**.
That is personal data about a minor, and it carries legal obligations:

- **COPPA** (United States) applies to children under 13. You must obtain *verifiable*
  parental consent — a ticked box is generally **not** sufficient on its own — publish a
  privacy policy, collect only what you actually need, and let a parent review or delete
  their child's data.
- **UK/EU GDPR-K** sets a similar bar (age 13–16 depending on the country) and requires a
  lawful basis, data minimisation and a retention limit.
- Schools in the US may also bring **FERPA** into scope.

Practical suggestions:

- **Ask for less.** A phone number is rarely needed for a maths practice site. Every field
  you drop is one you cannot lose in a breach. Consider parent email + a display name only.
- **Send the consent request to the parent's email**, not the child's, and record when and
  how consent was given.
- **Publish a privacy policy** covering what you store, why, for how long, and how to ask
  for deletion — then link it from the registration form.
- **Turn on row-level security** in Supabase so one account can never read another's data.
- Consider whether you need accounts at all: a per-device progress store with no personal
  data avoids nearly all of this.

I am not a lawyer, and this is not legal advice — but the requirements above are
well-documented and worth confirming with someone qualified before you go live.

---

## Checklist for going live

- [ ] Create the backend project and fill in `AUTH_CFG`
- [ ] Update `connect-src` in the CSP, then re-pin the script/style hashes
- [ ] Move the guest gate server-side if it needs to be enforced rather than suggested
- [ ] Reduce the registration fields to the minimum you truly need
- [ ] Write and link a privacy policy
- [ ] Put verifiable parental consent in place for under-13s
- [ ] Enable row-level security and test that one account cannot read another's data
- [ ] Turn on **Settings → Pages → Enforce HTTPS**
