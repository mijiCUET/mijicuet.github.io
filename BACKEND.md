# Accounts, OTP email and going live

## The one thing that needs a server

GitHub Pages serves files and nothing else. It cannot run code, so it **cannot send an
email**. Everything else in the sign-up flow already works in the browser:

| Step | Status |
|------|--------|
| Generate a random 6-digit code (`crypto.getRandomValues`, not `Math.random`) | ✅ done |
| Store it as a SHA-256 hash — the plain code is never kept | ✅ done |
| Hold it for **120 seconds**, then discard it | ✅ done |
| Single use — destroyed the moment it is accepted | ✅ done |
| Lock after 5 wrong attempts; 30-second resend cool-down | ✅ done |
| **Put that code in the parent's inbox** | ⚙️ needs a backend — wiring below |

Until a backend is connected the page runs in **demo mode** and shows the code on screen
(clearly labelled) so the flow can be walked through end to end.

---

## Turning on real accounts and real OTP email

The integration is already written and tested. Connecting it is **two values plus one CSP
line** — no code changes.

### 1. Create a Supabase project

Free tier. <https://supabase.com> → New project.

### 2. Copy your two keys

**Project Settings → API** — copy the *Project URL* and the *anon public* key.

Both are safe to publish. Row-level security is what protects the data, not secrecy of the
anon key. **Never** paste the `service_role` key — that one bypasses all security.

### 3. Paste them into `index.html`

Find `AUTH_CFG` near the top of the script:

```js
const AUTH_CFG = {
  supabaseUrl:  "https://YOUR-PROJECT.supabase.co",
  supabaseKey:  "YOUR-ANON-PUBLIC-KEY",
  otpTtlSec:    120,
  otpMaxTries:  5,
  resendWaitSec:30,
  guestSessions:1
};
```

The moment both are non-empty, `AUTH_MODE` flips to `"supabase"`, the on-screen code
disappears, and registration/verification/sign-in all go to Supabase instead of
`localStorage`. That switch is covered by tests.

### 4. Make the email send a *code*, not a link

This step is easy to miss and the flow silently breaks without it.

**Authentication → Email Templates → Confirm signup.** By default Supabase sends a magic
*link*. Replace the body so it sends the token instead:

```html
<h2>Your verification code</h2>
<p>Enter this code to finish setting up your child's account:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
<p>It expires in a few minutes. If you did not request it, ignore this email.</p>
```

`{{ .Token }}` is the 6-digit code. Also set **Authentication → Providers → Email → Confirm
email = on**.

> Supabase's own token TTL governs the real expiry, not the 120 s countdown on screen. Set it
> under **Authentication → Settings** if you want them to match.

### 5. Allow the page to talk to Supabase

In the `Content-Security-Policy` meta tag change:

```
connect-src 'none'
```
to
```
connect-src https://YOUR-PROJECT.supabase.co
```

Leave everything else alone — `default-src 'none'` and the absence of `unsafe-inline` are
doing real work.

### 6. Create the `profiles` table

SQL Editor → run this. It stores the child's first name, age and the consent record, and
locks each row to its owner:

```sql
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  child_name   text    not null,
  child_age    int     not null check (child_age between 4 and 18),
  consent_given boolean not null default false,
  consent_at   timestamptz,
  consent_method text,
  created_at   timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "own row: read"   on public.profiles
  for select using (auth.uid() = id);
create policy "own row: write"  on public.profiles
  for insert with check (auth.uid() = id);
create policy "own row: update" on public.profiles
  for update using (auth.uid() = id);
```

Verify it: sign in as one account and try to read another's row. You should get zero rows,
not an error.

### 7. Re-pin the CSP hashes — **last, after every edit**

You just changed the script, so the pinned hash no longer matches and the browser will
refuse to run the page. Run this from the repo folder:

```bash
python3 - <<'PY'
import re,hashlib,base64
p="index.html"; s=open(p,encoding="utf-8").read()
h=lambda t:"'sha256-"+base64.b64encode(hashlib.sha256(t.encode()).digest()).decode()+"'"
sc=" ".join(h(x) for x in re.findall(r"<script>(.*?)</script>",s,re.S))
st=" ".join(h(x) for x in re.findall(r"<style>(.*?)</style>",s,re.S))
s=re.sub(r"script-src [^;]+;","script-src "+sc+";",s,count=1)
s=re.sub(r"style-src [^;]+;","style-src "+st+";",s,count=1)
open(p,"w",encoding="utf-8").write(s); print("re-pinned")
PY
```

Then hard-reload and check the console. A CSP violation there means the hash is stale.

---

## What is sent where

| Data | Stored where | Why it is needed |
|------|--------------|------------------|
| Parent/guardian email | Supabase `auth.users` | Login identity, consent contact, OTP delivery |
| Password | Supabase (bcrypt, server-side) | Login |
| Child's **first name only** | `profiles.child_name` | To greet the child |
| Child's age | `profiles.child_age` | To pitch difficulty and to know if COPPA applies |
| Consent flag + timestamp + method | `profiles.consent_*` | Evidence of consent |

Deliberately **not** collected: phone number, child's own email, surnames, address, school.
This is data minimisation, and it is a legal requirement, not just good manners.

In demo mode the same fields live in `localStorage` with the password hashed by PBKDF2
(150 000 iterations, per-user salt).

---

## Honest limits that remain after wiring

1. **The guest gate is a courtesy, not a lock.** "One free session" is a `localStorage`
   flag. Private browsing or a different browser resets it. Enforcing it properly needs
   server-side identity — which means the free session stops being anonymous. That is a real
   trade-off, not an oversight.
2. **The anon key is public.** That is by design; row-level security is the actual control.
   Test your policies rather than trusting the key.
3. **Anything in `index.html` is readable by anyone.** Never put a `service_role` key, SMTP
   password or mail-service token in it.

---

## Before you collect data from children — please take this seriously

Even reduced to first name, age and a parent's email, this is personal data about a minor.

- **COPPA** (US, under 13) requires *verifiable* parental consent. A ticked box on the
  child's own screen is generally **not** sufficient by itself — the common cheap method is
  to email the parent and have them confirm. Because the address you collect *is* the
  parent's and it is OTP-verified, you are close to that bar, but confirm it with someone
  qualified. You also owe a privacy policy and a way for a parent to review or delete the
  data.
- **UK/EU GDPR-K** sets a similar bar (13–16 depending on country) and requires a lawful
  basis, data minimisation and a retention limit.
- **FERPA** may apply if US schools use the site.

Worth considering: do you need accounts at all? A per-device progress store with no personal
data avoids nearly all of this. Accounts buy you cross-device progress and an enforceable
gate — decide whether that is worth the obligations.

I am not a lawyer and this is not legal advice.

---

## Checklist for going live

- [ ] Supabase project created; URL + anon key in `AUTH_CFG`
- [ ] "Confirm signup" email template rewritten to send `{{ .Token }}`
- [ ] Email confirmation enabled
- [ ] `connect-src` updated to your project URL
- [ ] `profiles` table created **with row-level security on**, and cross-account read tested
- [ ] CSP hashes re-pinned (do this last) and the console checked for violations
- [ ] Privacy policy written and linked from the registration form
- [ ] Data-deletion route in place for parents
- [ ] Retention limit decided and implemented
- [ ] **Settings → Pages → Enforce HTTPS** turned on
- [ ] Register a real account end to end and confirm the email actually arrives
