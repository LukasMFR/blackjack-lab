# Blackjack Lab

A browser-based blackjack simulator with authentic international rule
profiles. **All money is fictional** — there are no deposits, payments,
accounts, prizes, or any real-money functionality of any kind. This is a
learning and entertainment project.

## Running locally

The app is plain HTML/CSS/JS with ES modules, so it needs any static file
server (modules do not load from `file://`):

```bash
cd blackjack-lab
python3 -m http.server 8000
# then open http://localhost:8000/
```

No build step, no dependencies, no backend.

## Running the engine checks

```bash
node tests/run.js
```

A zero-dependency test runner executes deterministic scenarios against the
engine using predefined shoes (soft/hard Aces, naturals, pushes, 3:2 and
6:5 payouts, insurance, doubles, splits, split Aces, re-splitting, ENHC and
peeked dealer blackjacks, all three dealer-blackjack loss modes, S17/H17,
early and late surrender, bankroll guards, duplicate-card and
duplicate-settlement prevention, legal-action calculation).

## Architecture

The game engine is completely independent from the interface: it never
touches the DOM, and the UI never makes rule decisions.

```
index.html               Application shell (semantic, translated at runtime)
src/styles/              tokens.css (theme x mode design tokens), base, layout,
                         cards, components
src/js/game/             The engine: constants, card, deck, shuffle, rng,
                         shoe, handEval, money, settlement, engine (round
                         state machine)
src/js/config/           Rule profiles: presets, validation, custom builder
src/js/i18n/             en.js, fr.js dictionaries + translation module
src/js/ui/               app.js (controller), render.js (table/panels),
                         settingsView.js (dialogs), cardView.js (cards),
                         storage.js (safe localStorage), format.js,
                         profileSummary.js
tests/                   Zero-dependency runner + deterministic scenarios
```

Key engine properties:

- **Exact money.** All amounts are integer cents; payout ratios are applied
  with exact integer arithmetic and throw instead of rounding.
- **Explicit state machine.** `WAITING_FOR_BET → INITIAL_DEAL → PLAYER_TURN
  → DEALER_TURN → SETTLEMENT → ROUND_COMPLETE`; illegal calls throw without
  corrupting the round.
- **Physical-card integrity.** Every card instance has a unique id; a shoe
  can never deal the same physical card twice.
- **Deterministic mode.** `Shoe.fromSequence()` deals a predefined card
  sequence for tests and debugging; normal play uses a Fisher–Yates shuffle
  with `crypto.getRandomValues`.
- **Masked snapshots.** The UI renders engine snapshots in which the dealer
  hole card is hidden until the engine reveals it.

## Rule profiles

Fully implemented and selectable (all use the shared core engine through
configuration only):

| Profile | Highlights |
|---|---|
| French casino (default) | 6 decks, ENHC, S17, BJ 3:2, insurance, no surrender, DAS, dealer BJ takes all bets |
| European | 6 decks, ENHC, S17, identical-rank pairs only |
| Las Vegas Strip | 6 decks, hole card + peek, S17, 3:2 |
| Atlantic City | 8 decks, hole card + peek, S17, late surrender |
| Vegas Downtown | 2 decks, hole card + peek, H17 |
| Single deck 3:2 | 1 deck, H17, no double after split |
| Blackjack 6:5 | 6:5 natural payout (deliberately worse odds) |
| Custom | Every supported rule chosen explicitly; contradictory combinations are coerced or rejected |

Casino presets are documented representatives — real tables vary, which is
why every setting is visible and the custom profile exists. The
`FRENCH_STANDARD` profile follows the Arrêté du 14 mai 2007 (French casino
regulation, blackjack section); table minimums/maximums are project
defaults, not regulation.

Dedicated variant families (Spanish 21, Pontoon, Double Exposure, Blackjack
Switch, Free Bet, Super Fun 21) are **not implemented**. The architecture
reserves hooks for them (variant family field, configurable deck
composition such as Spanish 48-card decks) but no unfinished variant is
exposed in the interface.

## Languages

English (default) and French. The browser language is used only as a
first-visit hint; the choice is persisted. All user-facing content is
translated, including accessibility labels, errors, and history entries.
Card indices localize too: `A J Q K` in English, `A V D R` in French.

## Appearance and themes

- **Appearance:** System / Light / Dark (System follows
  `prefers-color-scheme` live).
- **Visual themes:** *Classic casino* (felt table, restrained warm accents),
  *Minimal* (neutral surfaces), and *Salon privé* (an immersive private
  casino room: bordeaux felt in a walnut rail, aged brass, suede panels,
  and the Marcellus display face; all textures are generated locally with
  CSS/SVG, see `src/assets/ASSETS.md`). Every theme supports light and
  dark modes; all combinations use the same CSS custom-property tokens
  (`data-theme` × `data-mode`), never duplicated stylesheets. Salon-only
  material skins live in `theme-salon.css`, fully scoped under
  `[data-theme="salon"]`.

## Cards

Cards are self-contained HTML/CSS: corner indices, true pip layouts for
number cards, framed letters for court cards, and a CSS-pattern back. No
external or remote artwork is used anywhere in the project.

## Accessibility

- Semantic landmarks, skip link, logical tab order, visible focus states.
- Unavailable actions use `aria-disabled` and stay focusable, with a
  translated reason exposed via `aria-description` and `title`.
- A polite live region announces dealt cards, totals, and results.
- Status is never conveyed by color alone (text badges everywhere).
- `prefers-reduced-motion` disables all non-essential animation.
- Keyboard shortcuts (H/S/D/P/R, N) documented in the help panel; they
  never fire inside form fields or open dialogs.

## Persistence

Language, appearance, theme, selected profile, custom-rule settings, and
the per-profile bankroll are stored in `localStorage`. Malformed saved
values are discarded safely. Mid-round game state is intentionally **not**
persisted (reloading during a round returns to betting with the last
between-round bankroll). A confirmed reset restores the starting bankroll.

## Known limitations

- Dedicated non-standard variants are architecture-ready but not playable.
- Side bets, card counting aids, and strategy advice are out of scope by
  design for this phase.
- Game history is kept for the session only (last 30 rounds).
- The custom profile keeps table stakes at the project defaults
  (min 5 / max 1000, starting bankroll 1000).
