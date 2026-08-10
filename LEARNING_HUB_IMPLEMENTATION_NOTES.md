# Grade 3 Mathematics Learning Hub — Implementation Notes

## What changed

The updated `index.html` keeps the existing GitHub Pages + Cloudflare Worker authentication/progress architecture and adds four primary navigation destinations: **Home**, **Lesson**, **Practice**, and **Take Test**. When a validated session exists, the pseudonymous username and **Logout** control sit on the same navigation row. Clicking the username opens the performance dashboard.

After a normal header login, the learner lands on a dedicated performance dashboard. Practice/Test buttons reuse an already validated session rather than logging the learner out and asking for MFA again.

## Mastery model

The dashboard derives topic accuracy from the existing server-saved `progress.topics` counts.

- **Not started** — no recorded attempts.
- **Familiar** — the topic has attempts but cumulative accuracy is below 100%.
- **Proficient** — cumulative topic accuracy is 100%.
- **Mastered** — cumulative topic accuracy is 100% **and** that topic has also been answered perfectly in a unit test.

The unit-test-perfect flag is currently frontend metadata because the deployed Worker schema does not have a field for it.

## Lesson library

The new Lesson page contains 12 visual units:

1. Numbers & Number Sense
2. Addition & Subtraction
3. Multiplication & Division
4. Fractions
5. Measurement, Money & Time
6. Graphs & Data
7. Points, Lines, Rays & Angles
8. Shapes, Polygons & Symmetry
9. Perimeter & Area
10. 3D Solids, Nets & Cross-sections
11. Patterns & Problem Solving
12. Counting & Infinity Lab (enrichment)

The visuals are inline SVG so they work with the existing restrictive Content Security Policy. Examples include a triangle boundary unfolded into a straight perimeter line, numerator/denominator labeling, odd/even pairing, arrays for multiplication, parallel lines and angle diagrams, a cube net with six square faces, and a sphere cross-section producing a circular disk/circle boundary.

The lesson also corrects potentially ambiguous terminology: **reflex angle** is the standard angle type greater than 180° and less than 360°; a **reciprocal** is ordinarily a number concept (for example, the reciprocal of 4 is 1/4).

## Energy points, badges, and Math Challenge

Energy is calculated from authoritative saved learning activity plus local game rewards:

- +10 per correct answer
- +20 per completed session
- +50 per Proficient topic
- +100 per Mastered topic
- Math Challenge bonus: +5 per point scored at the end of a run
- Math Challenge entry cost: 25 energy

The Math Challenge lasts 60 seconds. Nine animated answer bubbles rise through the arena. A correct click advances immediately to another problem; difficulty increases with score. A wrong click removes two seconds. Score thresholds unlock Comet, Orbit, Nova, and Galaxy game badges.

Perfect lesson-unit tests also award unit badges.

## Persistence limitation in this frontend-only release

The existing Cloudflare Worker/API persists `highestUnlocked`, total attempted/correct counts, sessions, and per-topic attempted/correct counts. It does **not** currently expose server fields/endpoints for unit-test-perfect flags, energy spending, game best scores, or badge ownership.

Therefore this release keeps:

- question accuracy/session progress: **server authoritative**;
- unit-test-perfect flags, badge state, game best score, game bonuses, and spent energy: **browser `localStorage`**, namespaced to the pseudonymous username with `grade3LearningHub.v1.<username>`.

This means gamification metadata will not follow the learner to another browser/device and can be edited by someone with access to browser developer tools. It is suitable for the current small educational frontend, but not for high-stakes rewards.

### Recommended backend follow-up

For cross-device, tamper-resistant gamification, extend the Worker schema/API with server-validated fields such as `topicMastery`, `unitTests`, `energyLedger`, `badges`, and `gameBest`. The Worker should calculate/validate rewards rather than accepting arbitrary client totals.

## Deployment

1. Replace the repository root `index.html` with the generated `index.html`.
2. Keep `configure_frontend.py` with the project. The generated file has already been configured for `https://math-auth.miji-cuet-eee.workers.dev` and its inline script/style CSP hashes have been re-pinned.
3. Use `verify_release_learning_hub.py` in the repository root (or merge its new checks into your existing `verify_release.py`).
4. Run the normal backend verification/deployment process from the existing runbook.

## Verification performed here

- JavaScript parsed successfully with `node --check`.
- Exactly one inline `<style>` and one inline `<script>` are retained.
- CSP hashes were regenerated after the final modifications.
- Required new navigation, dashboard, lesson, game, energy, badge, and mastery identifiers/functions were checked statically.
- A full browser visual smoke test could not be completed in the execution environment because the available Chromium instance is administrator-blocked from loading local/localhost pages.
