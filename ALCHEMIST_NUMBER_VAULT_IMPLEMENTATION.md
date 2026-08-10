# The Alchemist’s Number Vault — Web Integration Notes

## What was added

The existing Grade 3 Mathematics Learning Hub now includes a new interactive game, **The Alchemist’s Number Vault**, launched from the learner performance dashboard beside **Math Challenge**.

The original main navigation remains unchanged: **Home, Lesson, Practice, Take Test**, followed by the account controls.

## Gameplay implemented

- Three-digit mechanical-style number lock with independent up/down reel controls.
- Animated vault door and reward chamber when the correct combination is entered.
- Two difficulty modes:
  - **Novice (ages 6–8):** addition/subtraction chain clues, 3-minute timer.
  - **Master (ages 9–11):** multiplication, digit totals, and relational logic, 2-minute timer.
- Fresh puzzle generation for every new vault.
- Master-mode puzzles are validated by enumerating all 1,000 possible three-digit combinations and accepting the generated clue set only when it has exactly one solution.
- Wrong attempts do not expose the code.
- Optional hint system; using a hint removes the no-hint reward bonus.
- Timer expiration reseals the vault and resets the current streak.
- Per-user solve count, current streak, best times, energy bonus, and vault badges.

## Blueprint correction

The supplied Master example gave the answer `246` with the clue “Digit 3 is a multiple of 4.” That clue is inconsistent because 6 is not a multiple of 4.

The implementation replaces that relationship with mathematically valid generated clues. Its safe fallback puzzle is:

1. All three digits add up to 12.
2. Digit 1 × Digit 2 = 8.
3. Digit 3 is 4 more than Digit 1.

This uniquely gives `246`.

## Integration with the existing learning hub

The game reuses the existing pseudonymous local learning-state namespace. No authentication endpoint or server progress schema was changed.

Vault state is stored under the existing per-username browser record:

```text
grade3LearningHub.v1.<username>
```

The new `vault` state records:

- `bonus`
- `solved`
- `streak`
- `bestNovice`
- `bestMaster`
- `badges`

Vault reward energy is included in the dashboard’s available-energy calculation. The badge shelf also displays Number Vault achievements.

### Badges

- **Copper Key** — crack the first vault.
- **Silver Key** — crack 5 vaults.
- **Golden Flask** — crack 10 vaults, or crack a Master vault with no hint.

## Authentication behavior

If a signed-out learner tries to open Number Vault, the existing login/MFA workflow is used. After successful authentication, the learner is routed back to the Number Vault automatically.

## Technical notes

- Self-contained HTML/CSS/JavaScript; no new framework or external asset dependency.
- Responsive layout for desktop, tablet, and phone.
- Uses the existing `esc()`, `rand()`, `pick()`, account, routing, energy, and local learning-state helpers.
- JavaScript syntax checked with Node.js after integration.
- The HTML was parsed after modification to verify the new view and controls are present with unique IDs.

## Primary file

`Alchemists_Number_Vault_Integrated.html`
