/**
 * Shared enums and constants for the blackjack engine.
 * The engine never touches the DOM; these values are its vocabulary.
 */

export const SUITS = Object.freeze(['SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS']);

export const RANKS = Object.freeze([
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
]);

/** Ranks removed from a Spanish deck (architecture hook for SPANISH_21). */
export const SPANISH_REMOVED_RANKS = Object.freeze(['10']);

export const ACTIONS = Object.freeze({
  HIT: 'HIT',
  STAND: 'STAND',
  DOUBLE: 'DOUBLE',
  SPLIT: 'SPLIT',
  SURRENDER: 'SURRENDER',
});

export const ROUND_STATES = Object.freeze({
  WAITING_FOR_BET: 'WAITING_FOR_BET',
  INITIAL_DEAL: 'INITIAL_DEAL',
  PLAYER_TURN: 'PLAYER_TURN',
  DEALER_TURN: 'DEALER_TURN',
  SETTLEMENT: 'SETTLEMENT',
  ROUND_COMPLETE: 'ROUND_COMPLETE',
});

export const DEAL_MODES = Object.freeze({
  ENHC: 'ENHC',
  AMERICAN_HOLE_CARD: 'AMERICAN_HOLE_CARD',
});

export const SURRENDER_MODES = Object.freeze({
  NONE: 'NONE',
  EARLY_SURRENDER: 'EARLY_SURRENDER',
  LATE_SURRENDER: 'LATE_SURRENDER',
});

export const DEALER_BJ_LOSS_MODES = Object.freeze({
  PEEK_PROTECTED: 'PEEK_PROTECTED',
  ALL_BETS_LOST: 'ALL_BETS_LOST',
  ORIGINAL_BETS_ONLY: 'ORIGINAL_BETS_ONLY',
});

export const SPLIT_PAIRING = Object.freeze({
  EQUAL_VALUE: 'EQUAL_VALUE',
  IDENTICAL_RANK: 'IDENTICAL_RANK',
});

export const DOUBLE_RESTRICTIONS = Object.freeze({
  ANY_TWO: 'ANY_TWO',
  NINE_TO_ELEVEN: 'NINE_TO_ELEVEN',
  TEN_ELEVEN: 'TEN_ELEVEN',
});

export const HAND_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  STOOD: 'STOOD',
  BUST: 'BUST',
  SURRENDERED: 'SURRENDERED',
  BLACKJACK: 'BLACKJACK',
});

export const RESULTS = Object.freeze({
  WIN: 'WIN',
  BLACKJACK_WIN: 'BLACKJACK_WIN',
  LOSS: 'LOSS',
  PUSH: 'PUSH',
  SURRENDER: 'SURRENDER',
});

/** Variant families. Only STANDARD is implemented; the rest are architecture hooks. */
export const VARIANT_FAMILIES = Object.freeze({
  STANDARD: 'STANDARD',
  SPANISH_21: 'SPANISH_21',
  PONTOON: 'PONTOON',
  DOUBLE_EXPOSURE: 'DOUBLE_EXPOSURE',
  BLACKJACK_SWITCH: 'BLACKJACK_SWITCH',
  FREE_BET_BLACKJACK: 'FREE_BET_BLACKJACK',
  SUPER_FUN_21: 'SUPER_FUN_21',
});
