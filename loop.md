Loop Engineering Task — Non-Repeating Grade 3 Problem Engine, Cross-Game Curriculum Coverage, Unique Problem Names, and Unique AI Topic Logos
0. Mission
Refactor the Grade 3 Mathematics Learning Hub so that a learner never receives the same mathematical problem twice after this feature is deployed, regardless of where the problem is encountered.
The non-repetition rule must apply across:
topic Practice;
standard Practice;
standard Tests;
level/unit assessments;
Lesson practice;
Lesson unit tests;
Math Challenge;
Vault;
any future game or activity that consumes Grade 3 questions.
At the same time:
every problem must have a stable unique technical identity;
every displayed problem must have a unique learner-facing problem name/title;
games must be able to draw questions from all eligible Grade 3 topics, not from a separate arithmetic-only bank;
every distinct canonical topic must have its own AI-designed logo;
the same logo must never be reused for two different topics;
the existing authentication, progress, mastery, security, CSP, deployment, and generator-discovery behavior must not be broken.
This is a correctness requirement, not merely a visual enhancement.
---
1. Repository context to preserve
Before editing, inspect the complete repository and use the existing implementation as the source of truth.
Important existing concepts/functions include:
`GEN`
`EXTRAGEN`
`GEOGEN`
`MULTIGEN`
`OLYGEN`
`allLevelGenerators(level)`
`engineTopicsForLevel(level)`
`allGradeTopics()`
`normalizeQuestion(q)`
`drawPool(...)`
`buildSession(...)`
`buildTopicSession(...)`
`buildLessonSession(...)`
`launchQuestions(...)`
`makeGameQuestion()`
`topicMeta(...)`
`topicIcon(...)`
`learningState()`
authenticated progress APIs
`configure_frontend.py`
`verify_release.py`
`verify_release_learning_hub.py`
The current project dynamically discovers topics from the generator engine. Preserve that design. Do not replace it with a manually maintained short curriculum list.
The current release has a large generator bank and many distinct domain labels. The new uniqueness layer must wrap the generator engine rather than bypassing it.
---
2. Hard definition of “no repeated problem”
2.1 Per-user uniqueness is mandatory
For one authenticated pseudonymous learner:
> Once a semantic problem has been reserved/shown to that learner, that semantic problem must never be served to that learner again in any mode.
This must persist across:
browser refreshes;
logout/login;
future sessions;
different devices;
Practice → Test transitions;
Lesson → Game transitions;
Math Challenge → Vault transitions;
any other combination of modes.
A browser-only `Set`, `sessionStorage`, or `localStorage` is not sufficient for the authoritative uniqueness guarantee.
The authoritative seen/reserved history must be server-side and bound to the authenticated pseudonymous account.
2.2 Intra-session uniqueness is mandatory
No session may contain the same semantic problem more than once.
This must be enforced before rendering the question.
2.3 Cross-mode uniqueness is mandatory
There must not be separate seen lists such as:
practice history;
test history;
game history;
lesson history.
Use one authoritative per-user semantic history for all educational question surfaces.
A question seen in Practice is therefore unavailable later in Math Challenge, Vault, a test, a lesson unit test, etc.
2.4 Global cross-user uniqueness is NOT the default requirement
Do not interpret “no repeated problems for any user” as “no two different learners may ever receive the same problem.”
The required invariant is:
> no repeat within the lifetime history of each learner.
A global all-learners uniqueness switch may be designed as an optional future mode, but it must not be required for this implementation because it would unnecessarily exhaust finite generator spaces and create much heavier global coordination.
---
3. Semantic uniqueness, not cosmetic uniqueness
A “new” problem must be mathematically/structurally new.
The following changes alone do not make a problem unique:
changing a character name;
changing a pet/object/place name;
changing punctuation;
changing whitespace;
changing capitalization;
changing the order of multiple-choice options;
changing answer-button positions;
changing SVG colors;
rotating or translating an otherwise identical figure;
swapping operands in a commutative expression, e.g. `3 + 7` versus `7 + 3`;
swapping factors in multiplication, e.g. `4 × 8` versus `8 × 4`;
rewording the exact same mathematical payload;
changing only the problem title while keeping the mathematical task identical.
The uniqueness system must therefore track at least two identities:
semantic identity — mathematical/structural identity;
render identity — exact rendered wording/figure/choices.
Semantic identity is the hard no-repeat gate.
---
4. Standard ProblemEnvelope
Every generator output used anywhere in the site must be normalized into one standard object before it can be selected.
Implement a structure equivalent to:
```js
{
  problemId: "...",
  semanticHash: "...",
  renderHash: "...",

  grade: 3,
  level: 1,
  domain: "Addition",
  generatorId: "arith.addition.two-digit.v1",
  templateId: "add.two-digit.no-regroup.v1",

  title: "Lantern Sum Trail",
  type: "num", // num | mc | multi | other supported type
  prompt: "...",
  answer: "...",
  answers: [...],
  choices: [...],
  fig: "...",

  semanticPayload: {...},
  renderPayload: {...},

  difficulty: 1,
  sourceMode: "practice"
}
```
Existing generator output does not need to be rewritten all at once if a compatibility adapter can safely enrich it.
However, every usable generator must ultimately expose enough stable metadata to compute semantic uniqueness correctly.
---
5. Stable generator IDs and template IDs
Every generator must have a permanent stable identifier.
Example:
```js
{
  id: "geo.area.rectangle.v1",
  templateId: "rectangle-area-known-sides.v1",
  minL: 2,
  ch: 6,
  f: L => ...
}
```
Requirements:
`generatorId` must not depend on array position.
`generatorId` must not change merely because code is moved.
`templateId` identifies the mathematical structure/template.
A generator containing genuinely different mathematical templates may assign a different `templateId` per returned problem.
Add a verification check that no two registered generators share the same `generatorId`.
Do not use raw array indices such as `GEN[14]` as permanent IDs.
---
6. Canonical semantic signature
Create a central function similar to:
```js
canonicalSemanticPayload(question)
```
and then:
```text
semanticHash =
SHA-256(
  schemaVersion
  + grade
  + canonicalDomain
  + generatorId
  + templateId
  + canonicalMathPayload
  + canonicalFigurePayload
)
```
6.1 Canonicalization rules
Implement explicit canonicalization rules by problem family.
Examples:
Addition / multiplication
For commutative operations, sort operands before hashing.
`3 + 9` and `9 + 3` must have the same semantic identity.
`4 × 7` and `7 × 4` must have the same semantic identity.
Subtraction / division
Operand order is meaningful and must be retained.
Fractions
Normalize mathematically equivalent representation where the educational task is the same.
Example:
If a task is simply “identify one-half,” then visual `2/4` versus `1/2` may or may not be structurally distinct depending on the generator intent. Encode this decision in the template’s semantic payload, not by raw text.
Geometry
Use mathematical figure parameters, not SVG serialization order.
Examples:
polygon type;
side lengths;
angle values;
grid dimensions;
transformation type;
coordinates after appropriate canonical normalization;
requested property.
Changing colors must not change semantic identity.
Graph/data questions
Canonicalize:
categories;
numeric values;
asked comparison/quantity;
graph type;
intended reasoning operation.
Word problems
Ignore superficial story-character names when forming semantic identity.
Include:
quantities;
operation structure;
number of steps;
units;
relationship graph;
requested unknown;
meaningful story condition.
Renaming “Maya” to “Noah” must not bypass the duplicate detector.
Multiple choice
Choice order must never affect semantic identity.
Select-all
Choice order must never affect semantic identity.
---
7. Render hash
Also compute a render hash for exact-render duplicate diagnostics.
Example:
```text
renderHash = SHA-256(
  normalized title
  + normalized prompt
  + canonical displayed figure
  + normalized choices
)
```
The render hash is useful for QA, but the semantic hash remains the authoritative no-repeat rule.
---
8. Unique problem names/titles
Every displayed problem must receive a learner-facing problem name.
Examples of style only:
“Sapphire Clock Trail”
“Rocket Garden Remainder”
“Moonlit Fraction Picnic”
“Polygon Harbor”
“Comet Coin Counter”
Do not reuse one fixed title for a generator.
8.1 Title requirements
A title must:
be age-appropriate;
be short;
not reveal the answer;
relate loosely to the topic or problem context;
avoid personal data;
avoid real learner names;
avoid inappropriate or frightening themes;
be unique for the semantic problem;
remain stable if the same semantic problem is regenerated internally before reservation.
8.2 Deterministic title generation
Prefer deterministic generation from:
```text
canonical topic
+ template family
+ semanticHash
```
This allows stable titles without storing a second mutable random mapping.
Use topic-specific lexicons and a collision-resistant suffix only when needed.
Example concept:
```js
makeProblemTitle(domain, templateId, semanticHash)
```
If a human-readable combination collides, derive another deterministic combination from later hash bytes.
Do not treat changing the title as creating a new semantic problem.
8.3 Story character names
If a word problem needs fictional people:
use a large age-appropriate fictional-name pool or deterministic pseudonym generator;
never use the learner’s account username as a story character unless explicitly designed;
never request or infer real personal information;
prevent the same story-character set from being overused for one learner;
changing story names must not change the semantic hash.
---
9. Server-side seen/reserved history
The existing authenticated backend must become authoritative for question uniqueness.
Do not rely on frontend gamification `localStorage` for this guarantee.
Add a server-side question-history model such as:
```json
{
  "problemHistoryVersion": 1,
  "seenSemanticHashes": [],
  "seenTitleHashes": [],
  "topicCounters": {},
  "generatorCounters": {}
}
```
The exact physical storage may be redesigned for scalability.
9.1 Preferred strong implementation
Use a storage mechanism that can enforce a unique key atomically:
```text
(username, semanticHash)
```
A database table with a UNIQUE/PRIMARY KEY on that pair is ideal.
If keeping the current GitHub-backed record store, use conflict-safe compare-and-swap/retry and batch reservation, and document that GitHub is not a high-write transactional database.
Do not silently claim a concurrency guarantee stronger than the storage layer can provide.
9.2 Reservation-before-display
To avoid cross-tab/cross-device races:
> A question is considered consumed when it is successfully reserved server-side, before it is displayed.
This may occasionally “waste” a fresh question if a learner closes the tab after reservation, but it guarantees that the question will not reappear.
Never wait until the learner submits an answer to mark the question as seen.
---
10. Batch reservation API
Avoid one backend write for every rendered question.
Create a batch flow similar to:
```http
POST /api/problems/reserve
Authorization: Bearer ...

{
  "mode": "topic-practice",
  "level": 3,
  "topic": "Fractions",
  "count": 12,
  "candidates": [
    {
      "semanticHash": "...",
      "problemId": "...",
      "generatorId": "...",
      "templateId": "...",
      "domain": "Fractions",
      "titleHash": "..."
    }
  ]
}
```
Server behavior:
authenticate user;
validate payload sizes;
reject malformed hashes/metadata;
compare candidates with that authenticated user’s history;
atomically reserve fresh candidates;
return the accepted candidate identities;
never allow the browser to select another user’s history path;
enforce reasonable rate and size limits.
Example response:
```json
{
  "accepted": ["hash1", "hash4", "hash9"],
  "requested": 12,
  "historyVersion": 17
}
```
The client then renders only accepted candidates.
If not enough candidates are accepted, generate more candidates and retry.
---
11. Central unique-question service
Replace mode-specific ad hoc selection with one service.
Target interface:
```js
await getUniqueQuestions({
  count,
  level,
  domains,
  subject,
  mode,
  allowedTypes,
  difficulty,
  gameId
})
```
This service must be used by:
`buildSession`;
`buildTopicSession`;
`buildLessonSession`;
level assessments;
unit tests;
Math Challenge;
Vault;
all future games.
Existing functions may remain as wrappers, but they must not independently bypass uniqueness.
---
12. Candidate-generation algorithm
Use a bounded but expandable candidate loop.
Example logic:
```text
requested = N
candidate budget = max(N * 20, 100)

1. choose eligible generators fairly
2. generate candidates
3. normalize candidate
4. calculate semantic payload
5. calculate semantic hash
6. calculate render hash
7. assign stable unique title
8. reject duplicates already generated in this candidate batch
9. submit candidate identities to server reservation API
10. keep only server-accepted candidates
11. if fewer than N were accepted:
      expand candidate budget
      rotate generators/templates
      retry
12. stop only when N fresh questions are obtained
   OR a genuine topic/template space exhaustion condition is reached
```
Do not silently fall back to previously seen questions.
---
13. No off-topic fallback
Current topic/lesson builders may fall back to a broad session when a requested pool is short.
For a user who explicitly selected a topic:
> never fill a Fractions practice session with unrelated Addition questions merely to reach the requested count.
Instead:
expand generation attempts;
rotate all generators that truly produce that topic;
use additional approved templates for that same topic;
if still exhausted, return fewer fresh questions with a clear message.
Correct category fidelity is more important than filling a fixed count with unrelated content.
Lesson-unit sessions may include the multiple domains explicitly assigned to that lesson unit, but must not escape the lesson’s domain set merely because a fresh pool is short.
---
14. Exhaustion policy
“No repeat” is stronger than “always show exactly N questions.”
If a finite generator family is exhausted for one learner:
never recycle a seen semantic problem;
never disguise a repeat with a different name/color;
expand the generator/template space if mathematically valid;
otherwise show an explicit friendly message such as:
> “You have completed all currently available fresh problems in this topic. Try another topic while more challenge patterns are added.”
A repeat must never be the hidden fallback.
---
15. Variety scheduler
Uniqueness alone is not enough. Avoid showing 12 structurally similar questions in a row.
Within each topic/session, balance:
generator IDs;
template IDs;
numerical ranges;
question types;
visuals/non-visuals;
one-step/two-step reasoning where level-appropriate;
contexts and units.
Prefer a least-recently-used or lowest-use-count strategy for eligible generator/template families.
Do not repeatedly sample one high-probability generator while ignoring others.
---
16. Game architecture — one curriculum engine for every game
Remove the concept that a game owns a tiny separate question bank.
Every game must use the same unique-question service.
Target:
```js
await getUniqueGameQuestion({
  gameId: "math-challenge",
  level,
  unlockedTopics,
  score,
  allowedTypes
})
```
and:
```js
await getUniqueGameQuestion({
  gameId: "vault",
  level,
  unlockedTopics,
  score,
  allowedTypes
})
```
16.1 Math Challenge
The existing Math Challenge must no longer be arithmetic-only.
It should be capable of serving Grade 3 questions from eligible topics including, when appropriate:
addition;
subtraction;
multiplication;
division;
fractions;
place value;
comparison;
odd/even;
money;
measurement;
time;
elapsed time;
graphs/data;
patterns;
perimeter;
area;
lines/angles;
shapes;
quadrilaterals;
triangles;
symmetry;
transformations;
3D solids;
nets;
cross-sections;
other level-eligible challenge/Supreme topics.
Use the generator engine as the source of truth so newly added domains become game-eligible automatically unless a game explicitly marks a question type unsupported.
16.2 Vault
Vault must use the same server-backed uniqueness history.
A problem seen in Math Challenge must not appear later in Vault.
A problem seen in Vault must not appear later in Practice or a Test.
16.3 Future games
Create the interface once.
New games should not implement their own raw random question generator unless the output is still normalized and routed through the central uniqueness/reservation service.
---
17. Game topic rotation
For mixed-topic games, use balanced topic rotation rather than pure random selection.
Recommended behavior:
build the eligible topic list for the learner’s current/unlocked level;
shuffle it with a secure/randomized session seed;
draw one question from each topic before repeating a topic when practical;
then reshuffle and continue;
always apply the per-user semantic history filter.
This means a sufficiently long game naturally covers many Grade 3 topics rather than repeatedly serving multiplication.
Difficulty may still adapt with score, but difficulty adaptation must occur inside the eligible topic rotation, not by collapsing back to arithmetic.
---
18. Game UI must support multiple question types
The current number-rain interaction is naturally suited to numeric answers. That is not enough for all Grade 3 topics.
Refactor the game rendering layer so it can display:
numeric answer choices;
standard multiple choice;
select-all/multi-select;
visual geometry questions;
graph questions;
clock/time visuals;
fraction visuals;
other existing generator figures.
Suggested abstraction:
```js
renderGameQuestion(problemEnvelope)
```
with type-specific renderers.
A game may define a temporary `allowedTypes` constraint for a particular mechanic, but it must not permanently reduce the overall game curriculum to arithmetic only.
If Math Challenge retains “falling bubbles,” the bubbles can contain text labels as well as numbers, or the UI can switch renderer based on question type.
---
19. Pre-reserve a game queue
A timed game must not perform a server reservation write after every correct answer.
At game start:
estimate a safe maximum question count;
create a large fresh candidate set;
reserve a queue of unique questions in one/few batched calls;
consume that queue during the timed run;
refill only if the learner reaches the queue end.
For a 60-second game, reserve enough questions that a very fast learner is unlikely to exhaust the queue.
Reserved questions count as seen even if the run ends before all are displayed. This preserves the no-repeat guarantee.
---
20. Unique AI-designed topic logos
The current generic icon-category approach must be replaced for topic cards.
Create one dedicated logo for every distinct canonical topic discovered by the engine.
20.1 Core invariant
For canonical topics `A` and `B`:
```text
if A != B:
    topicLogo(A) must not equal topicLogo(B)
```
The same canonical topic may reuse its own logo across levels and screens.
Example:
Addition always uses the Addition logo.
Addition and Subtraction must have different logos.
Area and Perimeter must have different logos.
Fractions and Unit Fractions must have different logos.
Geometry and Triangles must have different logos.
Bar Graph and Picture Graph must have different logos.
Measurement, Measurement · Length, and Measurement · Units must each have distinct logos.
20.2 AI design requirement
Design the SVG artwork as if produced by an AI visual-design pass:
concept-specific;
playful but academically clear;
child-friendly;
visually distinct;
cohesive as one design system;
readable at small card size;
no copied trademarks;
no copyrighted characters;
no external image dependencies.
Do not satisfy this by recoloring the same generic symbol 75 times.
The visual motif itself must differ.
Examples:
Addition: two groups flowing into one;
Subtraction: objects leaving a group;
Multiplication: array/grid motif;
Division: equal-sharing motif;
Fractions: partitioned whole;
Unit Fractions: one highlighted equal part;
Area: filled tile surface;
Perimeter: traced boundary;
Symmetry: mirrored halves;
Telling Time: clock face;
Elapsed Time: two clocks with directional path;
Bar Graph: vertical bars;
Picture Graph: repeated pictograms;
Place Value: hundreds/tens/ones blocks;
Nets: unfolded cube net;
Cross-sections: solid intersected by a plane.
Use a distinct concept for every discovered domain.
20.3 SVG constraints
Prefer inline SVG to preserve the existing restrictive frontend model.
Each topic logo should:
use a consistent viewBox, e.g. `0 0 64 64`;
avoid scripts;
avoid external URLs;
avoid external fonts;
avoid `<foreignObject>`;
avoid network-loaded images;
be safe for insertion through the existing trusted-logo function;
be decorative with appropriate accessibility handling;
inherit or use the existing design-system palette where practical.
20.4 Replace generic topic icon routing
Replace:
```js
topicMeta(domain) -> generic icon kind
topicIcon(kind)
```
for topic cards with something equivalent to:
```js
topicLogo(canonicalDomain)
```
and a structure such as:
```js
const TOPIC_LOGOS = {
  "Addition": "...unique SVG...",
  "Subtraction": "...different unique SVG...",
  ...
};
```
Keep descriptions in `TOPIC_META` or a similar metadata structure if useful.
20.5 Automatic logo coverage check
At verification time:
```js
const topics = allGradeTopics();
```
Every discovered canonical topic must have exactly one dedicated logo.
Fail verification if:
a topic has no logo;
two different topics return identical normalized SVG;
a fallback generic logo is used for a production topic;
a logo contains forbidden external/script content.
If the generator engine later adds a new topic, release verification should fail until a unique logo is designed for it.
---
21. Unique logo means more than a different color
The following do not count as sufficiently distinct topic logos:
exact same SVG with different fill color;
same shape rotated;
same shape mirrored;
same icon with only text changed;
same generic “numbers” icon for multiple number topics;
same generic polygon icon for every geometry topic.
Use unique conceptual artwork.
---
22. Lesson-unit icons versus topic logos
Lesson units may retain their own unit-level icon system.
The hard “one unique logo per topic” rule applies to canonical topic/domain cards and any topic identity used elsewhere.
If a lesson-unit icon happens to visually resemble a topic logo, that is acceptable only if the unit and topic are distinct UI concepts and the topic-to-topic uniqueness rule remains satisfied.
---
23. Problem title display
Add the unique problem title to the runner and games.
Suggested presentation:
```text
Fractions
Moonlit Fraction Picnic
[actual problem prompt]
```
The topic remains visible separately from the title.
Do not replace the real mathematical topic label with the creative title.
---
24. Migration behavior for existing learners
The current system does not appear to persist full historical question identities.
Therefore the new system cannot reliably reconstruct every problem an existing learner saw before this feature existed.
Document the migration truthfully:
> The no-repeat guarantee starts from the deployment of the new semantic-history system.
Do not claim retroactive deduplication of unknown historical questions.
For all questions served after migration, the guarantee is required.
---
25. Privacy requirements
Question history must contain identifiers/hashes and curriculum metadata only.
Do not add:
real names;
email addresses;
school information;
location;
birth dates;
advertising identifiers;
unnecessary device fingerprints.
Continue using the authenticated pseudonymous account as the learner key.
Story-character names are fictional content and must never be derived from real personal data.
---
26. Security requirements
Preserve the existing security posture.
Do not weaken:
CSP;
exact-origin backend connectivity;
authentication;
MFA;
session validation;
escaping;
request-size limits;
rate limits;
secret handling;
pseudonymous-account design.
Do not add:
third-party frontend scripts;
`eval`;
`new Function`;
`document.write`;
unsafe inline event handlers;
externally hosted topic-logo assets;
API keys in the frontend.
After frontend edits, regenerate/re-pin the required CSP hashes through the existing supported configuration process.
---
27. Backend abuse and size controls
The reservation endpoint must be bounded.
Validate:
maximum number of candidate hashes per request;
hash format/length;
generator ID length;
template ID length;
topic/domain length;
mode enum;
count range;
request body size;
authenticated account association.
Add appropriate per-user rate limiting without weakening current auth limits.
Never trust a browser-supplied username to select the history record. Use the authenticated server-side identity.
---
28. Storage growth strategy
Do not allow one learner record to grow without bound without a plan.
Choose and document one approach.
Preferred options:
Option A — database unique rows
Store:
```text
username_hash | semantic_hash | reserved_at | domain | generator_id
```
with a unique key on `(username_hash, semantic_hash)`.
Option B — sharded history files
If remaining on GitHub-backed storage, shard history by topic/hash prefix or by fixed-size pages instead of repeatedly rewriting one massive JSON record.
Option C — hybrid
Keep compact counters in the learner record and seen hashes in a dedicated server-side store.
Whichever method is chosen must preserve the no-repeat invariant.
A probabilistic structure such as a Bloom filter may be used only if its false-positive behavior is understood: false positives may reject genuinely new questions but must never permit a repeat.
---
29. Strong concurrency test
Test two simulated clients logged into the same learner account.
Both request fresh questions at nearly the same time.
Acceptance criterion:
> the two clients must not both receive/reserve the same semantic hash.
If the chosen GitHub storage implementation cannot make this guarantee under concurrency, either:
add conflict-safe atomic reservation with retry; or
move uniqueness history to storage that can enforce a unique constraint.
Do not hide the limitation.
---
30. Generator quality expansion
Some existing generator templates have very small finite parameter spaces or even fixed prompts.
Identify them.
For every topic, estimate:
number of generators;
approximate semantic parameter space;
templates that can return only one/few unique problems;
templates most likely to exhaust quickly.
Expand small spaces with valid Grade 3 variants where needed.
Do not expand by meaningless wording-only changes.
Possible expansion dimensions:
new valid number ranges;
new diagrams;
new relationships;
different unknown positions;
different step structures;
different units;
different data tables;
different shapes;
different graph datasets;
different reasoning directions;
different comparison targets.
All expansions must remain mathematically correct and level-appropriate.
---
31. Generator validation
Every generated question must be validated before reservation.
At minimum:
domain exists;
type is supported;
answer exists;
multi-answer problems have valid answer sets;
choices are unique;
correct answer(s) are present;
no impossible/ambiguous answer;
no malformed figure;
generator/template IDs are present;
semantic payload is serializable;
semantic hash is valid;
title exists.
Do not reserve malformed questions merely to fill a pool.
---
32. Correctness must not depend on title/name generation
The mathematical answer must be computed entirely from the mathematical payload.
Problem-title generation and story-character-name generation must never influence the correct answer.
---
33. Testing — required automated acceptance suite
Add a dedicated uniqueness/coverage verifier.
Suggested file:
```text
verify_unique_problem_engine.py
```
or integrate equivalent checks into the existing release verifiers.
Test A — generator IDs
every generator has a stable ID;
IDs are unique;
template IDs are present/valid.
Test B — intra-session duplicate test
For every level and topic:
generate many sessions;
assert zero duplicate semantic hashes within a session.
Test C — cross-session same-user test
Simulate one learner across many sessions.
Example target:
```text
2,000+ reserved problems
across Practice + Test + Lesson + Game modes
```
Assert zero repeated semantic hashes.
Increase the number when generator space permits.
Test D — cross-mode test
Explicit sequence:
```text
topic Practice
-> level Test
-> Lesson practice
-> Lesson unit test
-> Math Challenge
-> Vault
```
Assert no semantic hash appears twice.
Test E — cosmetic mutation test
Construct variants of the same math task with:
different child name;
reordered choices;
different punctuation;
commutative operand swap;
different colors.
Assert that variants expected to be semantically identical produce the same semantic hash.
Test F — genuinely different problem test
Change meaningful mathematical parameters.
Assert semantic hashes differ.
Test G — concurrent reservation test
Two clients reserve from overlapping candidate sets.
Assert server-side uniqueness prevents duplicate acceptance.
Test H — topic fidelity test
Request each topic independently.
Assert every returned problem belongs to that requested canonical topic/domain set.
No unrelated fallback.
Test I — game curriculum coverage
Run enough simulated Math Challenge and Vault draws to make coverage measurable.
Assert:
games are not arithmetic-only;
all eligible supported topics can be reached;
topic rotation is reasonably balanced;
no repeated semantic hashes occur.
Test J — logo coverage
For all topics from `allGradeTopics()`:
logo exists;
normalized SVG is non-empty;
no two different topics have identical SVG;
no forbidden external resource;
no generic fallback is used.
Test K — problem titles
Across a large generated sample:
every problem has a nonempty title;
no title collision occurs within the tested corpus;
titles do not reveal exact answers;
titles are stable for the same semantic hash.
Test L — existing release regression
Existing authentication/progress/security checks still pass.
Run:
```bash
python verify_release.py
python verify_release_learning_hub.py
```
or their updated replacements.
Run JavaScript syntax checking as already done by the release process.
---
34. Stress audit
Add a machine-readable report, for example:
```text
UNIQUE_GENERATION_AUDIT.md
```
Report:
total generator count;
total discovered topic count;
generator IDs;
semantic-space warnings;
duplicates found/rejected during stress generation;
final duplicate count after reservation;
topic logo count;
logo duplicate count;
game topic coverage;
cross-mode duplicate count;
concurrency-test result;
known exhaustion risks.
Final acceptance requires:
```text
cross-mode semantic repeats for one user: 0
intra-session semantic repeats: 0
duplicate topic logos: 0
missing topic logos: 0
```
---
35. Existing verification script updates
Update the release verifier so it statically/behaviorally checks for the new architecture.
At minimum verify the presence and use of:
central unique-question service;
semantic canonicalization;
semantic hashing;
stable generator IDs;
server reservation API;
no direct `makeGameQuestion()` arithmetic-only bypass;
unique topic-logo map;
logo coverage check;
game use of curriculum generators;
CSP integrity.
Do not make a verification check pass merely by searching for function names. Where practical, execute the relevant functions in a controlled test harness.
---
36. Refactoring rule for `makeGameQuestion()`
The current arithmetic-only `makeGameQuestion()` should not remain as a hidden alternate path.
Replace it with or route it through the central engine.
Acceptable:
```js
async function makeGameQuestion() {
  const q = await getUniqueGameQuestion(...);
  renderGameQuestion(q);
}
```
Not acceptable:
```js
function makeGameQuestion() {
  // old arithmetic-only random logic
}
```
---
37. Refactoring rule for `topicIcon()`
The current small generic icon-kind switch must not be the final topic-logo implementation.
Acceptable:
```js
function topicLogo(domain) {
  return TOPIC_LOGOS[canonicalTopicKey(domain)];
}
```
with one distinct entry per discovered topic.
Not acceptable:
```js
Fractions -> "fractions"
Unit Fractions -> "fractions"
Compare Fractions -> "fractions"
```
if all three render the same topic logo.
---
38. Keep dynamic topic discovery
Do not hard-code a separate “official topics” list merely for games or logos.
The generator engine remains the source of truth.
Use:
```js
allGradeTopics()
```
or equivalent dynamic discovery.
For logos, a static mapping is allowed, but verification must compare that mapping against dynamically discovered topics and fail on mismatch.
---
39. Difficulty behavior
Retain level gating:
Beginner;
Developing;
Intermediate;
Advanced;
Supreme.
Games may adapt difficulty with score, but must not serve a topic/problem above the learner’s allowed curriculum level unless the game is intentionally configured as an unlocked challenge mode.
Use generator `minL` and existing level logic as the source of truth.
---
40. Unit-test and assessment integrity
Do not let uniqueness break scoring or mastery.
Continue to record:
attempted;
correct;
sessions;
topic counts;
unit-test-perfect/mastery metadata according to current architecture.
The uniqueness reservation event is separate from answer correctness.
A learner who skips/closes a reserved problem may lose that problem from their future pool, but must not receive false correctness/progress credit.
---
41. Performance requirements
The UI must remain responsive.
Do not repeatedly brute-force thousands of generators on the main thread for every click.
Use:
prebuilt eligible-generator indices by level/domain;
candidate batching;
pre-reserved session queues;
cached topic metadata;
bounded retry loops;
asynchronous backend reservation.
If a large hashing batch is needed, use Web Crypto efficiently or perform canonical hash validation server-side.
---
42. Failure behavior
If uniqueness service/API is unavailable:
Do not silently fall back to non-deduplicated random questions while claiming the no-repeat guarantee.
Use a clear safe failure message, such as:
> “Fresh-question history is temporarily unavailable. Please try again.”
If an explicitly designed offline mode is added later, it must be clearly labeled as unable to guarantee cross-device lifetime uniqueness.
---
43. UX requirements
The learner should not need to understand hashes or reservations.
Normal UX:
choose topic/game;
receive fresh question;
see topic + unique problem title;
answer;
continue.
No visible technical identifiers are required.
Optionally show a positive small label such as:
```text
Fresh problem
```
but do not clutter the page.
---
44. Accessibility
New topic logos and game renderers must preserve accessibility.
Requirements:
decorative SVGs use `aria-hidden="true"` when the adjacent topic label supplies the accessible name;
interactive answers remain keyboard operable;
focus state remains visible;
no meaning communicated only by color;
figures that are essential to answering must have an accessible textual description or equivalent label;
game timing/status updates remain understandable.
---
45. Files expected to change
Inspect the actual repository and adapt filenames as needed.
Likely changes include:
```text
index.html
math-auth-backend/src/index.ts
verify_release.py
verify_release_learning_hub.py
README.md
LEARNING_HUB_IMPLEMENTATION_NOTES.md
SECURITY.md
SECURITY_AUDIT.md
DEPLOY_BACKEND.md
```
Potential new files:
```text
UNIQUE_GENERATION_AUDIT.md
verify_unique_problem_engine.py
```
If backend storage schema/configuration changes, update the relevant deployment configuration and documentation.
---
46. Documentation required
Update implementation notes with:
exact definition of semantic uniqueness;
when a question becomes reserved;
where per-user history is stored;
migration limitation for pre-deployment history;
game curriculum behavior;
unique topic-logo design;
exhaustion behavior;
concurrency guarantees and storage limitations;
how to add a new generator safely;
how to add a new topic logo;
how to add a new game without bypassing uniqueness.
---
47. How future generators must be added
Document this contributor contract.
Every new generator must define:
stable `generatorId`;
stable `templateId`;
domain;
minimum level;
semantic payload builder/canonicalization;
question renderer data;
correct answer;
validation compatibility.
A new generator is not complete until it passes uniqueness tests.
---
48. How future topics must be added
When a generator introduces a new canonical domain:
dynamic topic discovery finds it;
release verification notices the new domain;
a unique AI-designed topic SVG must be added;
game compatibility is checked;
metadata description is added;
tests must pass.
Do not allow the new topic to silently inherit another topic’s logo.
---
49. How future games must be added
Every future game must:
authenticate through existing flow as appropriate;
use the central unique-question service;
use the same per-user semantic history;
state supported question renderers/types;
obtain topics from the curriculum engine;
never create a private untracked duplicate-prone question bank.
---
50. Anti-cheating rule for the implementation itself
Do not “solve” the requirement by making every prompt technically unique with a random UUID while repeating the same math.
This is explicitly forbidden.
The following is invalid:
```text
Problem A17F: 8 × 4 = ?
Problem B99Q: 8 × 4 = ?
```
Those are the same semantic problem.
Likewise, this is invalid:
```text
Maya has 24 apples and puts 6 in each bag.
Noah has 24 apples and puts 6 in each bag.
```
if the underlying mathematical task is identical.
Both must collapse to the same semantic identity unless there is a meaningful structural difference.
---
51. Acceptance criteria — non-negotiable
The implementation is complete only when all of the following are true:
[ ] one authenticated learner cannot receive the same semantic problem twice after migration;
[ ] the guarantee spans Practice, Tests, Lessons, assessments, Math Challenge, Vault, and future game API use;
[ ] duplicate filtering is server-backed, not browser-only;
[ ] reservation occurs before display;
[ ] concurrent requests cannot reserve the same semantic problem for the same learner;
[ ] changing only names/text/order/colors does not bypass semantic deduplication;
[ ] every problem has a stable technical ID;
[ ] every problem has a unique learner-facing title;
[ ] games use the shared curriculum generator engine;
[ ] Math Challenge is not arithmetic-only;
[ ] Vault uses the same unique history;
[ ] game question rendering supports the necessary existing question types;
[ ] topic selection remains dynamic from the generator engine;
[ ] every discovered canonical topic has its own dedicated AI-designed logo;
[ ] no two different canonical topics reuse the same topic logo;
[ ] no production topic uses a generic fallback logo;
[ ] topic logos remain compatible with the restrictive CSP;
[ ] topic-specific practice never silently falls back to unrelated topics;
[ ] exhaustion never causes a repeat;
[ ] existing authentication/security/progress behavior remains intact;
[ ] CSP hashes are correctly re-pinned after final frontend edits;
[ ] automated release tests pass;
[ ] uniqueness stress audit reports zero cross-mode repeats;
[ ] logo audit reports zero duplicates and zero missing topic logos.
---
52. Implementation order
Use this order to reduce regression risk.
Phase 1 — inventory
inspect all generator arrays;
assign stable generator/template IDs;
inventory discovered domains;
identify small/exhaustible generator spaces;
inventory existing game paths;
inventory current generic topic icons.
Phase 2 — identity layer
standard `ProblemEnvelope`;
canonical semantic payload;
semantic hash;
render hash;
deterministic unique title.
Phase 3 — authoritative history
server-side history schema;
batch reservation API;
concurrency protection;
storage-growth strategy.
Phase 4 — central selection
central unique-question service;
replace `drawPool`/topic/lesson selection paths or make them wrappers;
remove unrelated-topic fallback.
Phase 5 — games
route Math Challenge through central service;
implement multi-topic rotation;
add multi-type game renderer;
route Vault through the same service/API;
pre-reserve game queues.
Phase 6 — logos
create unique AI-designed SVG for every discovered canonical topic;
replace generic topic icon reuse;
add automatic logo coverage/duplicate checks.
Phase 7 — verification
stress uniqueness;
cross-mode tests;
concurrency tests;
curriculum coverage tests;
logo uniqueness tests;
current security/release regression tests.
Phase 8 — documentation
update implementation notes;
security documentation;
deployment notes if backend storage changes;
generation audit.
---
53. Required final Loop Engineering report
When work is complete, return a concise engineering report containing:
A. What was changed
List files and architectural changes.
B. Before
Explain the previous behavior:
random generation without persistent semantic-history enforcement;
topic/lesson builders able to regenerate prior math;
arithmetic-only game path;
generic topic-logo reuse.
C. After
Explain:
semantic identity;
authoritative per-user reservation;
cross-mode no-repeat flow;
unified game question engine;
unique titles;
unique topic logos.
D. Tests performed
Include exact commands and results.
E. Quantitative audit
Include:
```text
discovered topics:
topic logos:
duplicate topic logos:
missing topic logos:

generators:
generator IDs duplicated:

same-user questions simulated:
semantic repeats:
render repeats:

cross-mode repeats:
concurrent reservation collisions:

Math Challenge reachable topics:
Vault reachable topics:
```
F. Remaining limitations
Be explicit about:
unknown pre-migration question history;
finite-space exhaustion;
any storage/concurrency caveat that could not be fully eliminated;
performance limits;
any game question type not yet supported.
Do not declare the system “repeat-proof” if any known bypass remains.
---
54. Final principle
The implementation should have exactly one authoritative rule:
> **Generate freely, but display only after the authenticated learner has atomically reserved a semantic problem identity that has never been reserved for that learner before.**
Everything else — Practice, Tests, Lessons, Math Challenge, Vault, titles, visuals, and future games — must consume that same rule.