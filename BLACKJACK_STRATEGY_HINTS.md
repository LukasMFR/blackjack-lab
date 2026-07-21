# Blackjack Strategy Hints — Authoritative Reference

**Project:** Blackjack Lab  
**Status:** implementation reference  
**Verified:** 2026-07-21  
**Scope:** total-dependent basic-strategy hints for standard blackjack profiles  
**Revision:** 1.2 — independent cell-by-cell re-verification against the cited charts

### Verification corrections in revision 1.2

- Table B: hard `11` versus dealer Ace corrected from Double/Hit to Hit. Doubling 11 against an Ace is an H17 play in 4–8-deck games; the S17 chart hits.
- Table D: hard `16` versus dealer 9 corrected from Surrender/Hit to Hit. Double-deck S17 surrender covers only 15 vs 10 and 16 vs 10/Ace.
- Table D: soft `A,6` versus dealer 2 reverted to Hit. The revision 1.1 change to Double/Hit incorrectly imported the single-deck play into the double-deck table.
- The section 9 verification cases were updated to match.

### Verification corrections in revision 1.1

- Table B: `9,9` versus dealer Ace corrected from Split to Stand.
- Table E: `8,8` versus dealer Ace now preserves the double-deck H17 DAS condition.
- Insurance and Even Money are now treated separately for 6:5 blackjack.

## 1. Purpose

This file defines the exact strategy tables that Blackjack Lab may use to display an optional action hint.

A hint means:

> the total-dependent basic-strategy action for the current hand and the exact active rule fingerprint.

It does **not** mean:

- a guaranteed winning action;
- a card-counting deviation;
- a composition-dependent decision based on every card already removed from the shoe;
- a betting recommendation;
- a strategy for a side bet;
- an approximation for a vaguely similar ruleset.

No single blackjack chart is universally correct. The hint system must match the actual rules, not merely a geographic profile name.

## 2. Accuracy boundary

The tables below are exact transcriptions of the cited total-dependent basic-strategy charts for their stated rule families.

A static total-dependent chart cannot be described as mathematically optimal for every exact card composition, especially in single-deck play. The interface should therefore say **Basic strategy** / **Stratégie de base**, not **Guaranteed best move** or **Perfect move**.

If the active rules do not exactly match a supported fingerprint, the application must show no hint rather than silently use the nearest table.

## 3. Action codes

| Code | Meaning |
|---|---|
| `H` | Hit |
| `S` | Stand |
| `D/H` | Double when legal and affordable; otherwise hit |
| `D/S` | Double when legal and affordable; otherwise stand |
| `P` | Split when legal and affordable; otherwise evaluate the same cards as a normal hard/soft hand |
| `P/H` | Split only when DAS is enabled and splitting is legal/affordable; otherwise hit |
| `P/D` | Split when DAS is enabled and splitting is legal/affordable; otherwise double if legal/affordable, else hit |
| `P/S` | Split when DAS is enabled and splitting is legal/affordable; otherwise stand |
| `R/H` | Surrender when legally available; otherwise hit |
| `R/S` | Surrender when legally available; otherwise stand |
| `R/P` | Surrender when legally available; otherwise split when legal/affordable; otherwise evaluate as a normal hand |
| `R[NDAS]/P` | Surrender only when surrender is legal **and DAS is disabled**; otherwise split when legal/affordable; otherwise evaluate as a normal hand |

`DAS` means **double after split**.

Conditional actions must be resolved against the engine's real list of legal actions. A hint must never recommend an action the player cannot actually perform.

## 4. Hand classification

Use this order:

1. Resolve the insurance decision separately.
2. If the hand is an eligible two-card splittable pair, use the pair table.
3. Otherwise, if at least one Ace is currently counted as 11, use the soft-total table.
4. Otherwise, use the hard-total table.

Additional rules:

- `5,5` is played as hard 10.
- `10,10`, `J,J`, `Q,Q`, `K,K`, or any permitted ten-value pair is played as hard 20 unless the active pairing rule and table explicitly say otherwise.
- A pair table applies only when the engine says the hand is legally splittable.
- A natural blackjack, completed hand, bust hand, surrendered hand, or locked split-Ace hand receives no action hint.
- After a hit, double and surrender are normally unavailable; conditional codes fall back accordingly.

## 5. Insurance and even money

Treat Insurance and Even Money as separate decisions.

### Insurance

Without card-count information:

- decline Insurance for every standard profile in this document;
- this remains true at a 6:5 table;
- do not reinterpret a normal half-bet Insurance wager as a special Even Money offer.

### Even Money

- With a normal 3:2 blackjack payout: decline Even Money.
- With a 6:5 blackjack payout: accept a genuine 1:1 Even Money settlement if the game explicitly offers it.
- With any other blackjack payout: return `UNSUPPORTED_STRATEGY` until the exact settlement has been verified.

The 6:5 exception affects only the special Even Money decision. It does not change the standard hit, stand, double, split, or surrender matrices.

The project must not infer card-counting deviations from shoe history.

## 6. Rule fingerprint selection

The resolver must use explicit rule values, including at least:

- deck count;
- standard 52-card deck composition;
- S17 or H17;
- hole-card/peek protection or ENHC;
- dealer-blackjack loss mode;
- double restrictions;
- DAS;
- surrender mode and current surrender eligibility;
- pairing rule;
- split limits;
- available bankroll;
- blackjack payout;
- whether a genuine Even Money settlement is offered.

Never select a table from the profile display name alone.

### Supported profile mapping

| Blackjack Lab profile | Strategy-table rule |
|---|---|
| `FRENCH_STANDARD` | Table A |
| `EUROPEAN_ENHC` | Table A only when the resolved game is S17, surrender is disabled, and dealer blackjack takes all committed bets |
| `LAS_VEGAS_STRIP` | Table B or C according to the actual S17/H17 setting and deck count |
| `ATLANTIC_CITY` | Normally Table B when its resolved preset is 8-deck S17; use actual settings |
| `VEGAS_DOWNTOWN` | Table D/E for two decks or Table F/G for one deck; use actual settings |
| `SINGLE_DECK_3_2` | Table F or G according to S17/H17 |
| `BLACKJACK_6_5` | Use the table for its underlying standard rule fingerprint; keep the separate 6:5 Even Money rule in section 5 |
| `CUSTOM` | Show a hint only when every strategy-relevant setting matches a supported fingerprint |

### Unsupported standard-rule combinations

Do not approximate these until a separately verified table is added:

- three-deck games;
- ENHC with H17;
- early surrender;
- unusual dealer-blackjack loss modes such as BB+1;
- dealer no-peek games where optional wagers are exposed in a way not represented above;
- nonstandard deck composition;
- dealer wins ordinary ties;
- player may hit or double after split Aces in a way requiring a dedicated chart;
- any rule combination whose strategy effect has not been verified.

## Table A — European No-Hole-Card, S17, 4–8 decks

**Exact rule fingerprint:** `deckCount ∈ {4,5,6,7,8}`; `dealMode = ENHC`; `dealerSoft17 = S17`; `dealerBlackjackLossMode = ALL_BETS_LOST`; `surrender = NONE`; standard 52-card decks.

This is the table used by `FRENCH_STANDARD`. The French profile resolves to six decks, double on any original two cards, DAS enabled, no surrender, blackjack 3:2, and split Aces only once. The conditional codes also let the same table remain correct when a European profile restricts doubling or disables DAS.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–16 | S | S | S | S | S | H | H | H | H | H |
| 17–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2–A,3 | H | H | H | D/H | D/H | H | H | H | H | H |
| A,4–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | S | D/S | D/S | D/S | D/S | S | S | H | H | H |
| A,8–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P/H | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | H | H | H | H |
| 4,4 | H | H | H | P/H | P/H | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P/H | P | P | P | P | H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | H | H | H | H |
| 8,8 | P | P | P | P | P | P | P | P | H | H |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | H |

## Table B — American/peek, S17, 4–8 decks

**Exact rule fingerprint:** `deckCount ∈ {4,5,6,7,8}`; dealer hole card with blackjack protection before player actions, or an OBO rule that returns optional double/split wagers; `dealerSoft17 = S17`.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | R/H | H |
| 16 | S | S | S | S | S | H | H | R/H | R/H | R/H |
| 17–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2–A,3 | H | H | H | D/H | D/H | H | H | H | H | H |
| A,4–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | S | D/S | D/S | D/S | D/S | S | S | H | H | H |
| A,8–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P/H | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | H | H | H | H |
| 4,4 | H | H | H | P/H | P/H | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P/H | P | P | P | P | H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | H | H | H | H |
| 8,8 | P | P | P | P | P | P | P | P | P | P |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | P |

## Table C — American/peek, H17, 4–8 decks

**Exact rule fingerprint:** `deckCount ∈ {4,5,6,7,8}`; dealer hole card with blackjack protection before player actions, or OBO; `dealerSoft17 = H17`.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | R/H | R/H |
| 16 | S | S | S | S | S | H | H | R/H | R/H | R/H |
| 17 | S | S | S | S | S | S | S | S | S | R/S |
| 18–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2–A,3 | H | H | H | D/H | D/H | H | H | H | H | H |
| A,4–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | D/S | D/S | D/S | D/S | D/S | S | S | H | H | H |
| A,8 | S | S | S | S | D/S | S | S | S | S | S |
| A,9–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P/H | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | H | H | H | H |
| 4,4 | H | H | H | P/H | P/H | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P/H | P | P | P | P | H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | H | H | H | H |
| 8,8 | P | P | P | P | P | P | P | P | P | R/P |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | P |

## Table D — American/peek, S17, double deck

**Exact rule fingerprint:** `deckCount = 2`; dealer hole card with blackjack protection before player actions, or OBO; `dealerSoft17 = S17`.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | D/H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | R/H | H |
| 16 | S | S | S | S | S | H | H | H | R/H | R/H |
| 17–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2–A,3 | H | H | H | D/H | D/H | H | H | H | H | H |
| A,4–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | S | D/S | D/S | D/S | D/S | S | S | H | H | H |
| A,8–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P/H | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | H | H | H | H |
| 4,4 | H | H | H | P/H | P/H | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P | P | P | P | P | P/H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | P/H | H | H | H |
| 8,8 | P | P | P | P | P | P | P | P | P | P |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | P |

## Table E — American/peek, H17, double deck

**Exact rule fingerprint:** `deckCount = 2`; dealer hole card with blackjack protection before player actions, or OBO; `dealerSoft17 = H17`.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | D/H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | R/H | R/H |
| 16 | S | S | S | S | S | H | H | H | R/H | R/H |
| 17 | S | S | S | S | S | S | S | S | S | R/S |
| 18–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2 | H | H | H | D/H | D/H | H | H | H | H | H |
| A,3–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | D/S | D/S | D/S | D/S | D/S | S | S | H | H | H |
| A,8 | S | S | S | S | D/S | S | S | S | S | S |
| A,9–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P/H | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | H | H | H | H |
| 4,4 | H | H | H | P/H | P/H | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P | P | P | P | P | P/H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | P/H | H | H | H |
| 8,8 | P | P | P | P | P | P | P | P | P | R[NDAS]/P |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | P |

## Table F — American/peek, S17, single deck

**Exact rule fingerprint:** `deckCount = 1`; dealer hole card with blackjack protection before player actions, or OBO; `dealerSoft17 = S17`.

This is total-dependent basic strategy. Single-deck composition-dependent exceptions are deliberately out of scope.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–7 | H | H | H | H | H | H | H | H | H | H |
| 8 | H | H | H | D/H | D/H | H | H | H | H | H |
| 9 | D/H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–15 | S | S | S | S | S | H | H | H | H | H |
| 16 | S | S | S | S | S | H | H | H | R/H | R/H |
| 17–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | D/H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | S | D/S | D/S | D/S | D/S | S | S | H | H | S |
| A,8 | S | S | S | S | D/S | S | S | S | S | S |
| A,9–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | P/H | H | H | H |
| 4,4 | H | H | P/H | P/D | P/D | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P | P | P | P | P | P/H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | P/H | H | R/S | H |
| 8,8 | P | P | P | P | P | P | P | P | P | P |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | P |

## Table G — American/peek, H17, single deck

**Exact rule fingerprint:** `deckCount = 1`; dealer hole card with blackjack protection before player actions, or OBO; `dealerSoft17 = H17`.

This is total-dependent basic strategy. Single-deck composition-dependent exceptions are deliberately out of scope.

### Hard totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 4–7 | H | H | H | H | H | H | H | H | H | H |
| 8 | H | H | H | D/H | D/H | H | H | H | H | H |
| 9 | D/H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| 10 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | H | H |
| 11 | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H | D/H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13–14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | H | R/H |
| 16 | S | S | S | S | S | H | H | H | R/H | R/H |
| 17 | S | S | S | S | S | S | S | S | S | R/S |
| 18–21 | S | S | S | S | S | S | S | S | S | S |

### Soft totals

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2–A,5 | H | H | D/H | D/H | D/H | H | H | H | H | H |
| A,6 | D/H | D/H | D/H | D/H | D/H | H | H | H | H | H |
| A,7 | S | D/S | D/S | D/S | D/S | S | S | H | H | H |
| A,8 | S | S | S | S | D/S | S | S | S | S | S |
| A,9–A,10 | S | S | S | S | S | S | S | S | S | S |

### Pairs

| Player hand | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,2 | P/H | P | P | P | P | P | H | H | H | H |
| 3,3 | P/H | P/H | P | P | P | P | P/H | H | H | H |
| 4,4 | H | H | P/H | P/D | P/D | H | H | H | H | H |
| 5,5 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 | Use hard 10 |
| 6,6 | P | P | P | P | P | P/H | H | H | H | H |
| 7,7 | P | P | P | P | P | P | P/H | H | R/S | R/H |
| 8,8 | P | P | P | P | P | P | P | P | P | P |
| 9,9 | P | P | P | P | P | S | P | P | S | P/S |
| 10,10 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 | Use hard 20 |
| A,A | P | P | P | P | P | P | P | P | P | P |


## 7. Dedicated blackjack variants

The standard tables above must **never** be used for these families:

| Variant family | Why it requires a dedicated strategy module |
|---|---|
| `SPANISH_21` | Spanish decks remove the four rank-10 cards; player 21 and bonus payouts change settlement and strategy |
| `PONTOON` | Rules, terminology, dealer-card visibility, forced actions, multi-card doubling, forfeits, bonuses, and loss modes vary materially |
| `DOUBLE_EXPOSURE` | Both dealer cards are visible; ties and blackjack payouts are commonly altered |
| `BLACKJACK_SWITCH` | Two hands are dealt, cards may be switched, and dealer 22 commonly pushes |
| `FREE_BET_BLACKJACK` | Free doubles/splits and dealer-22 push rules change the value of actions |
| `SUPER_FUN_21` | Multi-card doubles/surrender and special 21/blackjack payouts require card-count-aware tables |

For these variants, return `UNSUPPORTED_STRATEGY` until an exact dedicated ruleset, payout table, and strategy source have been implemented.

## 8. Resolver behaviour

Recommended pure-function contract:

```js
getBasicStrategyHint({
  rules,
  hand,
  dealerUpcard,
  legalActions,
  bankroll
}) => {
  status: "SUPPORTED" | "UNSUPPORTED_STRATEGY" | "NO_DECISION",
  primaryAction: "HIT" | "STAND" | "DOUBLE" | "SPLIT" | "SURRENDER" | "DECLINE_INSURANCE" | "DECLINE_EVEN_MONEY" | "ACCEPT_EVEN_MONEY" | null,
  tableId: string | null,
  cellCode: string | null
}
```

Required behaviour:

1. Match the exact strategy fingerprint.
2. Classify pair, soft, or hard.
3. Read one cell from one authoritative table.
4. Resolve the conditional code against actual legal actions and bankroll.
5. Return the resolved action.
6. Never modify game state.
7. Never auto-play the action.
8. Never expose a hint for an unsupported ruleset.
9. Never claim a hint guarantees profit.

## 9. Minimum verification cases

At minimum, automated tests should cover:

### French / ENHC S17

- Hard 11 vs 10 → Hit.
- Hard 11 vs Ace → Hit.
- Pair 8,8 vs 10 → Hit.
- Pair 8,8 vs Ace → Hit.
- Pair A,A vs 10 → Split.
- Pair A,A vs Ace → Hit.
- Soft A,7 vs 3 → Double when legal, otherwise stand.
- Insurance vs dealer Ace → Decline.

### Multi-deck American S17

- Hard 11 vs 10 → Double when legal, otherwise hit.
- Hard 11 vs Ace → Hit.
- Pair 8,8 vs Ace → Split.
- Pair 9,9 vs Ace → Stand.
- Hard 16 vs 10 with late surrender → Surrender; otherwise hit.
- Soft A,7 vs 2 → Stand.

### Multi-deck American H17

- Hard 11 vs Ace → Double when legal, otherwise hit.
- Hard 17 vs Ace with late surrender → Surrender; otherwise stand.
- Pair 8,8 vs Ace with late surrender → Surrender; otherwise split.
- Soft A,7 vs 2 → Double when legal, otherwise stand.
- Soft A,8 vs 6 → Double when legal, otherwise stand.

### Deck-count separation

- Two-deck hard 9 vs 2 → Double when legal; multi-deck hard 9 vs 2 → Hit.
- Two-deck S17 soft A,6 vs 2 → Hit; single-deck S17 soft A,6 vs 2 → Double when legal, otherwise hit.
- Two-deck S17 hard 16 vs 9 → Hit even with late surrender; multi-deck S17 hard 16 vs 9 with late surrender → Surrender.
- Double-deck H17 pair 8,8 vs Ace with late surrender and DAS disabled → Surrender.
- Double-deck H17 pair 8,8 vs Ace with DAS enabled → Split, even when late surrender exists.
- Single-deck hard 8 vs 5 → Double when legal; two-deck hard 8 vs 5 → Hit.
- Single-deck S17 soft A,7 vs Ace → Stand; multi-deck S17 soft A,7 vs Ace → Hit.

### Insurance and Even Money

- Standard Insurance wager without count information → Decline.
- Genuine Even Money with blackjack paying 3:2 → Decline.
- Genuine Even Money with blackjack paying 6:5 → Accept.
- A normal Insurance wager at a 6:5 table must still be declined.

### Safety

- Unsupported fingerprint → no hint.
- Insufficient bankroll resolves `D/H`, `P/H`, or `P/D` to the documented fallback.
- Input focus or UI state must not change the mathematical result.
- The hint service must not mutate the round.

## 10. Sources

### Primary French rules

- Légifrance — Arrêté du 14 mai 2007, Article 55-4, current casino blackjack rules:  
  https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006138051/

The regulation establishes, among other points, six decks, S17, blackjack paid 3:2, insurance, split rules, and the possibility of doubling any original two-card total. Surrender is casino-dependent and is disabled in Blackjack Lab's default French profile.

### Standard basic-strategy tables

- Wizard of Odds — 4-to-8-deck strategy, S17 and H17:  
  https://wizardofodds.com/games/blackjack/strategy/4-decks/
- Wizard of Odds — Double-deck strategy, S17 and H17:  
  https://wizardofodds.com/games/blackjack/strategy/2-decks/
- Wizard of Odds — Single-deck strategy, S17 and H17:  
  https://wizardofodds.com/games/blackjack/strategy/1-deck/
- Wizard of Odds — European no-hole-card strategy:  
  https://wizardofodds.com/games/blackjack/strategy/european/
- Wizard of Odds — Rule-configurable strategy calculator:  
  https://wizardofodds.com/games/blackjack/strategy/calculator/
- Wizard of Odds — Surrender strategy details:  
  https://wizardofodds.com/games/blackjack/surrender/
- Wizard of Odds — 6:5 Even Money exception:  
  https://wizardofodds.com/ask-the-wizard/blackjack
- UK-21 — Six-deck S17 ENHC, double on any two cards, DAS strategy table:  
  https://www.uk-21.org/BJ-ENHC-BS-TABLE.shtml

### Dedicated variants

- Spanish 21: https://wizardofodds.com/games/spanish-21/
- Pontoon: https://wizardofodds.com/games/pontoon/australian/
- Double Exposure: https://wizardofodds.com/games/double-exposure/
- Blackjack Switch: https://wizardofodds.com/games/blackjack-switch/
- Free Bet Blackjack: https://wizardofodds.com/games/free-bet-blackjack/
- Super Fun 21: https://wizardofodds.com/games/super-fun-21/

## 11. Final implementation rule

The strategy-hint feature is allowed to be incomplete, but it is not allowed to be approximately wrong.

When in doubt:

```text
NO VERIFIED HINT FOR THIS RULESET
```

is the correct result.
