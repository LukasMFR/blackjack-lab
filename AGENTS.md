# Blackjack Lab: Project Rules

## 1. Project Purpose

Build a browser-based blackjack simulator that supports the major blackjack rule systems used around the world. The French casino profile remains the default, but the engine must not be France-only.

This project is:

- A fictional-money game.
- A learning and entertainment project.
- A vanilla web project using HTML, CSS, and JavaScript.
- Not a real-money casino.
- Not a gambling service.
- Not connected to deposits, withdrawals, payments, or prizes.

---

## 2. Current Development Phase

The current priority is the **game rules and game engine only**.

Do not work on visual design yet.

For now:

- Do not create a polished user interface.
- Do not add animations.
- Do not add sounds.
- Do not add decorative casino effects.
- Do not spend time on responsive design.
- Do not use the Taste skill unless the user explicitly starts the visual-design phase.
- A minimal temporary interface is allowed only when necessary to manually run the game.

The installed Taste skill will be used later for the visual and UI phase.

---

## 3. Technical Constraints

Use only:

- HTML.
- CSS.
- Vanilla JavaScript.
- Native browser APIs.
- JavaScript ES modules.

Do not use:

- React.
- Vue.
- Angular.
- Svelte.
- Tailwind CSS.
- Bootstrap.
- TypeScript.
- A frontend framework.
- A backend.
- A database.
- User accounts.
- External game engines.

Do not add a dependency unless the user explicitly approves it.

---

## 4. Architecture Rules

The game engine must be completely independent from the interface.

The game engine must never:

- Read from the DOM.
- Write to the DOM.
- Display alerts.
- Create HTML.
- Depend on CSS.
- Depend on button elements.
- Store rules inside UI code.

Keep these responsibilities separate:

1. Card and deck logic.
2. Shoe and shuffle logic.
3. Hand-value calculation.
4. Blackjack rules.
5. Betting and bankroll logic.
6. Round state and available actions.
7. User-interface rendering.

There must be one authoritative implementation for every rule. Do not duplicate game logic in multiple files.

---

## 5. Game Profiles

The engine must support named rule profiles. A profile is a complete, immutable set of blackjack rules.

The default profile is:

```text
FRENCH_STANDARD
```

Default French settings:

| Setting | Default |
|---|---:|
| Number of decks | 6 |
| Starting bankroll | 1,000 |
| Default bet | 50 |
| Deal mode | European No Hole Card |
| Dealer action on soft 17 | Stand |
| Blackjack payout | 3:2 |
| Insurance | Available |
| Surrender | Disabled |
| Double after split | Allowed |
| Split Aces | Once only |
| Dealer blackjack loss mode | All committed bets lost |
| Side bets | Disabled |

The engine must include these standard profiles:

| Profile | Main characteristics |
|---|---|
| `FRENCH_STANDARD` | 6 decks, ENHC, S17, 3:2, insurance available, no surrender, DAS allowed |
| `EUROPEAN_ENHC` | European no-hole-card rules with deck count, S17/H17, DAS and surrender configurable |
| `LAS_VEGAS_STRIP` | American hole card, dealer peek, multi-deck, usually S17, 3:2, DAS allowed |
| `ATLANTIC_CITY` | 8 decks, American hole card and peek, S17, 3:2, DAS and late surrender allowed |
| `VEGAS_DOWNTOWN` | 1 or 2 decks, American hole card and peek, commonly H17, 3:2, other rules configurable |
| `SINGLE_DECK_3_2` | One deck, natural blackjack paid 3:2, all other rules explicit and configurable |
| `BLACKJACK_6_5` | Standard blackjack engine with natural blackjack paid 6:5; never treat it as equivalent to 3:2 |
| `CUSTOM` | Every supported rule supplied explicitly by configuration |

Casino names are descriptive presets, not universal truths. Real tables may differ. Every profile value must be visible, explicit, and overridable through configuration.

The architecture must also allow dedicated rule modules for major non-standard blackjack families:

- `SPANISH_21`
- `PONTOON`
- `DOUBLE_EXPOSURE`
- `BLACKJACK_SWITCH`
- `FREE_BET_BLACKJACK`
- `SUPER_FUN_21`

These variants must not be simulated by changing only one or two standard settings when their core rules differ. Each one requires its own documented rule module, payout table, legal-action logic, and settlement logic.

---

## 6. Cards and Shoe

### 6.1 Deck composition

A standard blackjack deck contains exactly 52 cards:

- 13 ranks.
- 4 suits.
- No jokers.

Six standard decks contain exactly 312 cards.

Deck composition must be configurable for dedicated variants. For example, Spanish 21 uses a 48-card Spanish deck with the four rank-10 cards removed while Jacks, Queens, and Kings remain.

### 6.2 Card values

- Cards 2 through 9 use their printed value.
- 10, Jack, Queen, and King are worth 10.
- An Ace is worth 11 unless that would make the hand exceed 21.
- One or more Aces must automatically be reduced from 11 to 1 when required.

### 6.3 Shuffle

Use a correct Fisher–Yates shuffle.

For normal play, use a browser cryptographic random source when available. Do not use a visibly predictable card sequence.

The shoe must also support a predefined card sequence for debugging and deterministic scenarios.

### 6.4 Card integrity

A physical card instance may appear only once in the shoe.

Never:

- Duplicate a card accidentally.
- Draw a card that was already removed.
- Reinsert a card during an active shoe.
- Create cards during a round.

---

## 7. Initial Deal Modes

The active profile determines the dealing procedure.

### 7.1 European No Hole Card (`ENHC`)

Initial dealing order:

1. One card to the player.
2. One visible card to the dealer.
3. A second card to the player.

The dealer does not receive a second card during the initial deal. The dealer draws it only after all active player hands have completed their actions.

### 7.2 American Hole Card (`AMERICAN_HOLE_CARD`)

Initial dealing order:

1. One card to the player.
2. One visible card to the dealer.
3. A second card to the player.
4. One face-down hole card to the dealer.

When dealer peek is enabled and the upcard is an Ace or a ten-value card, the dealer checks for blackjack before normal player actions begin.

When dealer peek is disabled, the hole card remains unresolved until the dealer turn.

### 7.3 Variant-Specific Deals

Variants such as Double Exposure, Blackjack Switch, Pontoon, and Free Bet Blackjack may use different initial layouts or multiple player hands. Their dealing rules must be implemented in their dedicated variant module.

Player cards are face up. Dealer-card visibility is controlled entirely by the active deal mode.

---

## 8. Hand Evaluation

Every hand evaluation must provide at least:

- The best legal total.
- Whether the hand is soft.
- Whether the hand is hard.
- Whether the hand is a natural blackjack.
- Whether the hand is bust.
- Whether the hand contains a pair eligible for splitting.

Definitions:

- **Soft hand:** at least one Ace is currently counted as 11.
- **Hard hand:** no Ace is counted as 11.
- **Bust:** the best possible hand total is greater than 21.
- **Natural blackjack:** exactly two original cards totaling 21, without being created by a split.

A hand containing more than two cards and totaling 21 is not a blackjack.

A two-card 21 created after splitting is not a blackjack.

---

## 9. Player Actions

The possible player actions are:

```text
HIT
STAND
DOUBLE
SPLIT
SURRENDER
```

Only actions that are legal in the current state may be offered.

### 9.1 Hit

- Draw exactly one card.
- Recalculate the hand immediately.
- If the hand exceeds 21, mark it as bust.
- A bust hand ends immediately.

### 9.2 Stand

- Draw no additional card.
- Mark the hand as complete.

### 9.3 Double

Double is allowed only when:

- The hand has exactly two cards.
- The player has enough fictional bankroll to match the original hand bet.
- The active rule profile permits doubling.

When doubling:

1. Add an amount equal to the current hand bet.
2. Draw exactly one additional card.
3. End the hand immediately.

The default profile allows doubling on any two-card total, including after a split.

### 9.4 Split

A split is allowed only when:

- The hand contains exactly two cards accepted as a pair by the active profile.
- The player has enough fictional bankroll to place an equal additional bet.
- The configured split limit has not been reached.

The profile must explicitly choose one pairing rule:

- `EQUAL_VALUE`: all ten-value cards may be paired together.
- `IDENTICAL_RANK`: only cards with the same rank may be paired.

Examples under `EQUAL_VALUE` include 8 and 8, King and Queen, or 10 and Jack. Under `IDENTICAL_RANK`, King and Queen may not be split.

After a split:

1. Create two independent hands.
2. Move one original card to each hand.
3. Attach the original bet to the first hand.
4. Place an equal new bet on the second hand.
5. Deal one additional card to each hand.
6. Play the hands one at a time in a stable order.

Re-splitting non-Ace pairs must be supported when the configured rule profile permits it.

### 9.5 Split Aces

Under the default profile:

- A pair of Aces may be split only once.
- Each split Ace receives exactly one additional card.
- No further hit is allowed on either split-Ace hand.
- A 21 obtained after splitting Aces is not a natural blackjack.
- It is paid as a normal winning hand at 1:1.

### 9.6 Surrender

Surrender is disabled in the default French profile.

The engine must support these configurable modes:

- `NONE`
- `EARLY_SURRENDER`
- `LATE_SURRENDER`

General rules:

- Surrender is available only on an eligible original two-card hand.
- It must occur before hit, double, or split.
- The player normally loses half of the hand bet and receives the other half back.

Timing and dealer-upcard restrictions depend on the profile:

- Early surrender occurs before the dealer checks for blackjack.
- Late surrender occurs only after dealer blackjack has been ruled out.
- Any restriction against surrendering versus an Ace or ten-value upcard must be explicit in configuration.

---

## 10. Dealer Rules

The dealer has no strategic choices. Dealer behavior is controlled by the active profile.

Common configurable rules:

- Hit on 16 or less.
- Stand on hard 17 or more.
- Either stand on soft 17 (`S17`) or hit soft 17 (`H17`).
- Continue drawing until the configured stopping rule is met or the dealer busts.

Dealer timing depends on the deal mode:

- Under ENHC, the dealer draws the second card after every player hand is complete, bust, surrendered, or automatically closed.
- Under American hole-card rules, the dealer already has a second card and reveals it at the correct profile-defined time.
- Under peek rules, dealer blackjack may end the round before normal player actions.

An Ace is counted as 11 whenever that produces the best legal total without exceeding 21.

---

## 11. Natural Blackjack and Dealer Blackjack

A player natural blackjack is:

- An Ace plus any ten-value card.
- Exactly two original cards.
- Not produced after a split.

A natural blackjack uses the payout configured by the active profile, normally 3:2 or 6:5.

A player natural blackjack against dealer blackjack is a push unless a dedicated variant explicitly defines another result.

Dealer-blackjack handling must support these modes:

### 11.1 `PEEK_PROTECTED`

Used by American peek games.

- The dealer checks for blackjack before normal player actions when required.
- If the dealer has blackjack, the round ends immediately.
- Players are not exposed to later double or split wagers.

### 11.2 `ALL_BETS_LOST`

Common European no-hole-card behavior.

- Players may act before the dealer's blackjack is known.
- If the dealer later has blackjack, every non-blackjack hand loses.
- All committed wagers on that hand, including double and split additions, are lost.

### 11.3 `ORIGINAL_BETS_ONLY`

Used by some no-hole-card games.

- The original wager may be lost to dealer blackjack.
- Extra wagers created by doubles or splits are returned according to the configured rule.

Never infer dealer-blackjack behavior from geography alone. It must be an explicit profile setting.

---

## 12. Insurance

Insurance is offered only when the active profile allows it and the dealer's visible card is an Ace.

Insurance rules:

- The insurance bet normally equals half of the original main bet.
- The player must have enough fictional bankroll.
- If the dealer has blackjack, insurance normally pays 2:1.
- If the dealer does not have blackjack, the insurance bet is lost.
- The main hand is resolved separately.

Resolution timing depends on the deal mode:

- Under peek rules, resolve insurance immediately after the dealer checks the hole card.
- Under ENHC, resolve insurance when the dealer receives the second card.

Insurance must never be selected automatically.

An “even money” option may be supported only as an explicit profile feature and must be mathematically equivalent to taking insurance on a player blackjack.

---

## 13. Round Resolution

Resolve each player hand independently.

### 13.1 Immediate player bust

A player hand that exceeds 21 loses immediately.

### 13.2 Dealer bust

If the dealer exceeds 21:

- Every remaining non-bust, non-surrendered player hand wins.
- A normal win pays 1:1.
- A valid natural blackjack pays 3:2.

### 13.3 Dealer does not bust

For each remaining hand:

- Player total greater than dealer total: player wins.
- Player total lower than dealer total: player loses.
- Equal totals: push.
- Player natural blackjack beats a dealer 21 made with more than two cards.
- Dealer natural blackjack beats every non-blackjack player hand.
- Natural blackjack against natural blackjack: push.

### 13.4 Push

For a push:

- Return the full hand bet.
- Do not add profit.
- Do not record the result as a win or a loss.

---

## 14. Payout Rules

Use these default payouts:

| Result | Profit |
|---|---:|
| Normal win | 1:1 |
| Natural blackjack | 3:2 |
| Insurance win | 2:1 |
| Push | 0 |
| Surrender | Loss of 1/2 bet |
| Loss | Loss of full bet |

A winning bet must return both:

1. The original stake.
2. The profit.

Example:

- Bet: 50
- Normal win: bankroll receives 100 total.
- Natural blackjack: bankroll receives 125 total.
- Push: bankroll receives 50 total.

---

## 15. Bankroll and Money Calculations

All money is fictional.

Default values:

```text
Starting bankroll: 1000
Default base bet: 50
```

Money calculations must be exact.

Do not use floating-point arithmetic for bankroll operations.

Store money using the smallest supported integer unit.

Rules:

- A bet is removed from the available bankroll when committed.
- A player cannot bet more than the available bankroll.
- A player cannot double or split without enough remaining bankroll.
- A payout is applied exactly once.
- A hand may never be settled twice.
- The bankroll may never become `NaN`.
- The bankroll may never become negative through an illegal action.

The engine must support a 3:2 payout without rounding errors.

---

## 16. Round State

Use an explicit state machine.

Recommended round states:

```text
WAITING_FOR_BET
INITIAL_DEAL
PLAYER_TURN
DEALER_TURN
SETTLEMENT
ROUND_COMPLETE
```

Actions that do not belong to the current state must be rejected.

Examples:

- No hit before the initial deal.
- No bet during settlement.
- No double after a hit.
- No split after a hand is complete.
- No new round before the previous round is settled.

Every state transition must be deliberate and traceable.

---

## 17. Configuration

Rules that may vary by casino or variant must be represented as configuration values, including:

- Profile identifier and variant family.
- Number of decks and deck composition.
- Deal mode: ENHC, American hole card, double exposure, or variant-specific.
- Dealer peek behavior.
- Dealer stands or hits on soft 17.
- Blackjack payout.
- Normal-win payout.
- Insurance availability, size, payout, and timing.
- Surrender type: none, early, or late.
- Double restrictions.
- Double after split.
- Maximum number of split hands.
- Whether equal-value or identical-rank cards may be split.
- Whether split Aces may be re-split.
- Number of cards allowed after splitting Aces.
- Whether a split 21 counts as blackjack.
- Dealer-blackjack loss mode: peek protected, all bets lost, or original bets only.
- Push rules, including special dealer-22 behavior where applicable.
- Special bonuses and payout tables.
- Special actions such as switch, free double, free split, or five-card tricks.
- Side-bet availability.

Do not scatter configuration checks throughout unrelated UI code.

### 17.1 Standard Blackjack Profiles

Standard profiles must use the shared core engine whenever their differences are expressible through configuration.

### 17.2 Dedicated Variant Modules

The following families require dedicated behavior beyond a standard profile:

- **Spanish 21:** Spanish decks omit the four rank-10 cards; player 21 and bonus payouts require dedicated resolution rules.
- **Pontoon:** terminology, dealer-card visibility, forced-hit rules, five-card tricks, and payout priorities vary by Pontoon ruleset.
- **Double Exposure:** both dealer cards are visible; altered payouts and dealer-win-on-tie rules may apply.
- **Blackjack Switch:** two simultaneous hands, card switching, altered blackjack payout, and dealer 22 push behavior.
- **Free Bet Blackjack:** designated doubles and splits use free wagers; dealer 22 usually pushes non-blackjack hands.
- **Super Fun 21:** player-friendly action rules and special payouts require a dedicated payout and settlement table.

Every dedicated variant must declare all deviations from standard blackjack in one authoritative specification. Do not blend rules from different variants.

---

## 18. Side Bets

Do not implement side bets in the initial version.

Excluded features include:

- Perfect Pairs.
- 21+3.
- Hyper Blackjack.
- Dealer-result bets.
- Progressive jackpots.
- Any other optional wager.

The core blackjack game must be correct before any optional bet is considered.

---

## 19. Strategy and Probability Features

Do not implement card counting, betting systems, or automatic strategy advice in the first version.

The initial engine must focus on:

- Correct dealing.
- Correct actions.
- Correct hand values.
- Correct dealer behavior.
- Correct settlement.
- Correct bankroll calculations.

A strategy trainer or simulation mode may be added later as a separate feature.

Never claim that any strategy guarantees profit.

---

## 20. Code Quality Rules

Code must be:

- Clear.
- Modular.
- Deterministic when given a predefined shoe.
- Easy to inspect.
- Easy to modify.
- Free from duplicated rule logic.

Use:

- Small focused modules.
- Explicit names.
- Pure functions where practical.
- JSDoc for public game-engine functions.
- Constants or enums for states, actions, ranks, suits, and results.

Avoid:

- Large all-in-one files.
- Hidden global state.
- Magic numbers.
- Rule decisions inside event listeners.
- Bankroll changes spread across multiple unrelated functions.
- Silent error recovery.

Invalid actions should fail clearly without corrupting the round.

---

## 21. Scope Control

Before adding a feature, verify that it belongs to the current phase.

Current scope:

- Card model.
- Shoe model.
- Hand evaluation.
- Rule profiles and global configuration.
- Standard blackjack profiles.
- Player actions.
- Dealer behavior.
- Round settlement.
- Fictional bankroll.

Out of scope until explicitly requested:

- Final visual identity.
- Taste-based UI design.
- Animations.
- Sound.
- Multiplayer.
- Accounts.
- Online synchronization.
- Real-money functionality.
- Payments.
- Leaderboards.
- Achievements.
- Card counting tools.
- Advanced analytics.
- Side bets.
- Full implementation of dedicated non-standard variants unless explicitly requested.

The architecture must already be compatible with every listed profile and variant family, but implement dedicated variants one at a time only when explicitly requested.

Do not expand the scope without explicit user approval.

---

## 22. Source of Truth

There is no single universal blackjack ruleset.

For every named profile or dedicated variant:

- Store the complete rule definition in one place.
- Document the source used for that profile.
- Record any deliberate project simplification.
- Never silently combine rules from different casinos or jurisdictions.
- Prefer official regulations, official casino rules, or the game owner's published rules over secondary summaries.

For `FRENCH_STANDARD`, the primary reference is the French casino regulation:

- Arrêté du 14 mai 2007 relatif à la réglementation des jeux dans les casinos.
- Section concerning blackjack, especially Article 55-4.

For geographic presets such as Las Vegas Strip, Downtown Las Vegas, Atlantic City, or generic European blackjack, treat the profile as a documented representative preset. Real casino tables may use different rules, so every setting must remain visible and configurable.

For proprietary variants such as Spanish 21, Blackjack Switch, Free Bet Blackjack, Double Exposure, Pontoon, or Super Fun 21, use a dedicated rules specification and payout table before implementation.
