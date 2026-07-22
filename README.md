<p align="center">
  <img src="src/assets/logo/logo-full.svg" alt="Blackjack Lab" width="440">
</p>

# Blackjack Lab

A browser-based blackjack simulator with authentic international rule
profiles. **All money is fictional**: there are no deposits, payments,
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
duplicate-settlement prevention, legal-action calculation), plus the
basic-strategy resolver (rule-fingerprint selection, the documented
verification cases, conditional and bankroll fallbacks, insurance and
even money, no engine mutation) and its hint rendering and persistence.

The suite also covers the local multiplayer stack: the multi-seat table
engine (turn order, per-seat insurance/surrender, disconnects during
betting/decisions/turns, independent settlement), the wire protocol
(malformed/duplicated/out-of-order/incompatible frames), manual
signalling payloads (round-trips, stale and corrupted codes), the QR
encoder, and full host+client session scenarios over in-memory
transports (join, rejection, turn enforcement, reconnect tokens,
persistence restore, pause, session end).

## Architecture

The game engine is completely independent from the interface: it never
touches the DOM, and the UI never makes rule decisions.

```
index.html               Solo application shell (semantic, translated at runtime)
multiplayer.html         Local multiplayer shell (menu, pairing wizard, table)
src/styles/              tokens.css (theme x mode design tokens), base, layout,
                         cards, components, multiplayer
src/js/game/             The engine: constants, card, deck, shuffle, rng,
                         shoe, handEval, money, settlement, actionRules and
                         handPlay (shared per-hand rules), engine (solo round
                         state machine)
src/js/config/           Rule profiles: presets, validation, custom builder
src/js/strategy/         Basic-strategy tables A–G + pure hint resolver
src/js/i18n/             en.js, fr.js dictionaries + translation module
src/js/ui/               app.js (controller), render.js (table/panels),
                         settingsView.js (dialogs), cardView.js (cards),
                         strategyHint.js (hint chip), storage.js (safe
                         localStorage), focusModality.js (pointer vs
                         keyboard focus rings), format.js, profileSummary.js
src/js/multiplayer/      tableEngine (authoritative multi-seat table),
                         protocol, signalling, stateSync, hostSession,
                         clientSession, peerConnection, qr, qrScanner,
                         ui/ (mpApp controller + mpViews rendering)
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

Casino presets are documented representatives. Real tables vary, which is
why every setting is visible and the custom profile exists. The
`FRENCH_STANDARD` profile follows the Arrêté du 14 mai 2007 (French casino
regulation, blackjack section); table minimums/maximums are project
defaults, not regulation.

Dedicated variant families (Spanish 21, Pontoon, Double Exposure, Blackjack
Switch, Free Bet, Super Fun 21) are **not implemented**. The architecture
reserves hooks for them (variant family field, configurable deck
composition such as Spanish 48-card decks) but no unfinished variant is
exposed in the interface.

## Basic strategy hints (optional)

An optional aid, **disabled by default** and persisted locally. When
enabled in the settings, an open hint line near the action buttons names
the total-dependent basic-strategy action for the current hand
(“Basic strategy: Hit”) and a short, detached hairline marks the
recommended button without ever activating it. Insurance advice appears
inside the insurance dialog: declined without count information, exactly
like the reference charts (a genuine even-money settlement would be
declined at 3:2 and accepted at 6:5).

The resolver (`src/js/strategy/`) is a pure module fed by engine
snapshots. It selects one verified strategy table for the exact active
rule fingerprint — deck count, ENHC/peek, S17/H17, dealer-blackjack loss
mode, DAS, surrender, pairing rule, payout, never the profile name — and
resolves conditional cells against the actions the engine actually
allows, so an unaffordable double or a closed surrender window falls
back correctly. Rules that match no verified table show no hint rather
than an approximation. The tables, their rule fingerprints and their
sources (Wizard of Odds charts, UK-21, the French regulation) are
documented in `BLACKJACK_STRATEGY_HINTS.md`.

Hints are informational only: nothing is ever played automatically, no
card counting or shoe history is involved, and no strategy guarantees a
profit. Solo play only.

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
- Keyboard shortcuts (H/S/D/P/R, N) are documented in the help panel. During
  Insurance, A accepts (Accept/Accepter) and C continues without it
  (Continue/Continuer); those decision-only keys never conflict with normal
  gameplay. Shortcuts never fire inside editable controls or open dialogs.
- A pending decision is a real modal: the panel takes focus when it opens,
  traps Tab, and ignores Escape, so no table action can fire behind it. This
  applies to early surrender as well as Insurance — early surrender has no
  letter shortcut, since forfeiting half the bet should take a deliberate
  press on a focused button.

## Persistence

Language, appearance, theme, selected profile, custom-rule settings, the
strategy-hints preference, and the per-profile bankroll are stored in
`localStorage`. Malformed saved
values are discarded safely. Mid-round game state is intentionally **not**
persisted (reloading during a round returns to betting with the last
between-round bankroll). A confirmed reset restores the starting bankroll.

## Local multiplayer (experimental)

Several devices on the same local network can play at one table. The
feature is fully serverless: **no backend, no matchmaking, no signalling
server, no STUN/TURN**. The app can still be served from GitHub Pages;
all game traffic travels directly between the paired devices over WebRTC
DataChannels.

### Roles

- **Host** (“Host a local game”): one device runs the authoritative
  game. It owns the shoe and card order, the rule profile, seats,
  fictional bankrolls, bets, turn order, dealer play, settlement and
  history. The host may also sit at the table as a normal player.
- **Clients** (“Join a local game”): every other device sends only
  *intents* (join, ready, bet, action, decision, leave) and renders only
  confirmed host snapshots. Clients never generate cards or compute
  outcomes locally.

### Manual pairing

Because there is no server, WebRTC signalling is manual, one player at a
time:

1. The host creates a room (name, max players, whether the host plays,
   rule profile, starting bankroll, bet limits) and opens
   **Invite a player**. The app generates a WebRTC offer and shows it as
   a QR code and a copyable/shareable text code.
2. The joining device opens **Join a local game**, enters a display
   name, and scans or pastes the invitation code. It generates an
   answer, shown again as QR / copyable code.
3. The answer goes back to the host (scan, paste, or the native Share
   sheet). The host connects the player; the direct peer connection
   opens and the player appears in the lobby.
4. Repeat for each additional player.

Camera QR scanning uses `getUserMedia()` and the bundled `qr-scanner`
decoder. It can use a trustworthy native `BarcodeDetector` implementation
when present and otherwise falls back to its Web Worker decoder, including on
iOS/iPadOS and macOS Safari. Camera access requires HTTPS (localhost is also
accepted during development); manual copy/paste remains available everywhere.
Pairing codes are versioned, compressed (`CompressionStream`), integrity-
checked and expire after 10 minutes; a stale or foreign code fails with
a clear message. A short room code alone can never discover a room —
there is no server to look it up on.

### Protocol

`src/js/multiplayer/protocol.js` defines a versioned JSON protocol
(`PROTOCOL_VERSION 1`). Every frame is an envelope
`{v, t, id, seq, p}` with a unique message id and a per-sender monotonic
sequence number. Client→host types: `JOIN_REQUEST`, `PLAYER_READY`,
`PLACE_BET`, `CLEAR_BET`, `GAME_ACTION`, `DECISION`, `LEAVE_ROOM`.
Host→client types: `JOIN_ACCEPTED`, `JOIN_REJECTED`, `PLAYER_LIST`,
`STATE_SNAPSHOT`, `ROUND_STARTED`, `TURN_CHANGED`, `ROUND_COMPLETED`,
`PLAYER_DISCONNECTED`, `SESSION_ENDED`, `ERROR`.

Every incoming frame is structurally validated; malformed, oversized,
unknown, unexpected, duplicated, out-of-order or incompatible-version
frames are rejected before any game code runs. The host never trusts
client-provided bankrolls, cards, turn ownership or results — every
command is re-validated by the table engine, which throws on anything
illegal. Authoritative state flows as full `STATE_SNAPSHOT` payloads
with a monotonically increasing revision; clients ignore any snapshot
that is not newer than what they already applied, which makes delayed,
duplicated and out-of-order snapshots harmless.

### The multiplayer table

`src/js/multiplayer/tableEngine.js` orchestrates seats, betting, turn
order, the shared dealer and per-seat settlement. All blackjack *rules*
are the same single implementations the solo engine uses
(`game/actionRules.js`, `game/handPlay.js`, `game/handEval.js`,
`game/settlement.js`, `game/money.js`) — no rule logic is duplicated,
and the solo engine's mathematical behaviour is unchanged (the full solo
test suite still passes untouched).

Round flow: players bet and ready up → host deals → per-seat early
surrender / insurance decisions (when the profile offers them) → players
act in seat order (Hit / Stand / Double / Split / Surrender as the
profile allows) → dealer plays → every seat settles independently →
results and history sync to every device.

Disconnect policy: during betting the pending bet is refunded and the
seat sits out; during a pending decision the offer is declined; during
the seat's turn (or when its turn arrives) remaining active hands stand
automatically and are settled normally. A leaver's seat is released at
the end of the round.

### Reconnection and persistence

`JOIN_ACCEPTED` carries a per-player reconnect token. Joining devices
store it per room; if the connection drops, re-pairing with a fresh
invitation code restores the same seat, name and bankroll. The host
persists room state (names, tokens, fictional bankrolls, history)
between rounds in `localStorage`, so an accidental reload offers
“Restore room” — connections cannot survive a reload, so every player
re-pairs, but nothing is lost. Mid-round card state is deliberately
never persisted, exactly like the solo session store.

### Limitations and troubleshooting

- All devices should normally be on the same Wi-Fi / local network.
  Guest networks and AP/client isolation commonly block peer-to-peer
  traffic — if pairing never completes, try another network or a phone
  hotspot.
- The host must keep the page open; a desktop or laptop is the most
  comfortable host. Phones can host, but backgrounding the browser or
  locking the device may interrupt the room.
- Pairing codes expire after 10 minutes and are single-use; generate a
  fresh invitation for each player and after any failed attempt.
- Browsers hide local IPs behind mDNS (`.local`) candidates; on rare
  networks where mDNS resolution between devices is blocked, direct
  connections may fail even on the same Wi-Fi.
- The enhanced solo motion director does not run on the multiplayer
  table (classic card animations are used); audio, reduced-motion,
  theme, appearance and language preferences all apply.
- Multiplayer sessions are not persisted on any server. All money
  remains fictional.

## Known limitations

- Dedicated non-standard variants are architecture-ready but not playable.
- Side bets and card counting aids are out of scope by design for this
  phase; strategy advice goes no further than the optional
  total-dependent basic-strategy hints.
- Game history is kept for the session only (last 30 rounds).
- The custom profile keeps table stakes at the project defaults
  (min 5 / max 1000, starting bankroll 1000).
