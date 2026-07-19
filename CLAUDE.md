# Blackjack Lab — Project Rules

## 1. Project Purpose

Build a browser-based blackjack simulator inspired by the standard rules used in French land-based casinos.

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

## 5. Default Game Profile

The default profile is named:

```text
FRENCH_STANDARD
```

Default settings:

| Setting | Default |
|---|---:|
| Number of decks | 6 |
| Starting bankroll | 1,000 |
| Default bet | 50 |
| Dealer hole card | No |
| Dealer action on soft 17 | Stand |
| Blackjack payout | 3:2 |
| Insurance | Available |
| Surrender | Disabled |
| Double after split | Allowed |
| Split aces | Once only |
| Side bets | Disabled |

All casino-dependent rules must remain configurable. Do not silently hardcode an establishment-specific variation.

---

## 6. Cards and Shoe

### 6.1 Card set

Each deck contains exactly 52 cards:

- 13 ranks.
- 4 suits.
- No jokers.

Six decks contain exactly 312 cards.

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

## 7. Initial Deal — European No Hole Card

Use the European No Hole Card procedure.

Initial dealing order:

1. One card to the player.
2. One visible card to the dealer.
3. A second card to the player.

The dealer does **not** receive a hidden second card during the initial deal.

The dealer receives the second card only after all active player hands have completed their actions.

All dealt cards are face up.

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

- The hand contains exactly two cards of equal blackjack value.
- The player has enough fictional bankroll to place an equal additional bet.
- The configured split limit has not been reached.

Examples of equal blackjack value:

- 8 and 8.
- King and Queen.
- 10 and Jack.

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

Surrender is disabled in the default profile.

The engine may support it as a configurable rule.

When enabled:

- It is available only on the original two-card hand.
- It must occur before hit, double, or split.
- It is unavailable when the dealer's visible card is an Ace.
- The player loses half of the hand bet.
- The other half is returned.

---

## 10. Dealer Rules

The dealer acts only after every player hand is complete, bust, surrendered, or automatically closed.

The dealer then draws the second card.

Dealer behavior:

- Hit on 16 or less.
- Stand on 17 or more.
- Stand on soft 17.
- Continue drawing until reaching at least 17 or going bust.
- The dealer has no strategic choices.

An Ace must be counted as 11 when doing so produces a total of at least 17 without exceeding 21.

---

## 11. Natural Blackjack and European Dealer Blackjack

A player natural blackjack is:

- An Ace plus any ten-value card.
- Exactly two original cards.
- Not produced after a split.

A natural blackjack pays 3:2 unless the dealer also has a natural blackjack.

Because the dealer receives no hole card initially:

- Players may hit, double, or split before the dealer's blackjack is known.
- If the dealer later receives a ten-value card with an Ace showing, or an Ace with a ten-value card showing, the dealer has blackjack.
- Under the default profile, dealer blackjack defeats every non-blackjack player hand.
- All amounts committed to a losing hand, including added double and split bets, are lost.
- A player natural blackjack against dealer blackjack is a push.

This behavior must be explicit and must not be replaced with American hole-card behavior.

---

## 12. Insurance

Insurance is offered only when the dealer's visible card is an Ace.

Insurance rules:

- The insurance bet equals half of the original main bet.
- The player must have enough fictional bankroll.
- Insurance is resolved after the dealer draws the second card.
- If the dealer has blackjack, insurance pays 2:1.
- If the dealer does not have blackjack, the insurance bet is lost.
- The main hand is resolved separately.

Insurance must never be automatically selected.

No “even money” shortcut is required.

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

Rules that may vary by casino must be represented as configuration values, including:

- Number of decks.
- Dealer stands or hits on soft 17.
- Blackjack payout.
- Insurance availability.
- Surrender availability.
- Double restrictions.
- Double after split.
- Maximum number of split hands.
- Whether equal-value or identical-rank cards may be split.
- Whether split Aces may be re-split.
- Number of cards allowed after splitting Aces.
- European dealer-blackjack loss behavior.

Do not scatter configuration checks throughout unrelated UI code.

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
- Rule configuration.
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

Do not expand the scope without explicit user approval.

---

## 22. Source of Truth

For the default French profile, the primary rule reference is the French casino regulation:

- Arrêté du 14 mai 2007 relatif à la réglementation des jeux dans les casinos.
- Section concerning blackjack, especially Article 55-4.

When a project rule intentionally differs from a casino-specific variation, document the difference clearly in code comments and configuration.
