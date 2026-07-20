import {
  DEAL_MODES,
  DEALER_BJ_LOSS_MODES,
  DOUBLE_RESTRICTIONS,
  SPLIT_PAIRING,
  SURRENDER_MODES,
  VARIANT_FAMILIES,
} from '../game/constants.js';

/**
 * Rule profiles. A profile is a complete, immutable, explicit rule set.
 * Geographic presets are documented representatives, not universal truths;
 * every value here is visible and (via CUSTOM) overridable.
 *
 * Sources:
 * - FRENCH_STANDARD: Arrêté du 14 mai 2007 relatif à la réglementation des
 *   jeux dans les casinos (blackjack section, art. 55-4 and following).
 *   Simplification: table min/max bets are project defaults, not regulation.
 * - US / European presets: representative rule sets as commonly documented
 *   for those markets; real tables vary, which is why CUSTOM exists.
 */

const BASE = Object.freeze({
  family: VARIANT_FAMILIES.STANDARD,
  removedRanks: Object.freeze([]),
  normalWinPayout: Object.freeze({ numerator: 1, denominator: 1 }),
  blackjackPayout: Object.freeze({ numerator: 3, denominator: 2 }),
  insuranceEnabled: true,
  insurancePayout: Object.freeze({ numerator: 2, denominator: 1 }),
  surrender: SURRENDER_MODES.NONE,
  surrenderVsAce: false,
  doubleRestriction: DOUBLE_RESTRICTIONS.ANY_TWO,
  doubleAfterSplit: true,
  maxSplitHands: 4,
  splitPairing: SPLIT_PAIRING.EQUAL_VALUE,
  resplitAces: false,
  splitAcesOneCardOnly: true,
  splitTwentyOneIsBlackjack: false,
  penetration: 0.75,
  startingBankrollUnits: 1000,
  defaultBetUnits: 50,
  minBetUnits: 5,
  maxBetUnits: 1000,
});

function defineProfile(overrides) {
  return Object.freeze({ ...BASE, ...overrides });
}

export const PROFILES = Object.freeze({
  FRENCH_STANDARD: defineProfile({
    id: 'FRENCH_STANDARD',
    decks: 6,
    dealMode: DEAL_MODES.ENHC,
    dealerPeek: false,
    dealerHitsSoft17: false,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.ALL_BETS_LOST,
  }),

  EUROPEAN_ENHC: defineProfile({
    id: 'EUROPEAN_ENHC',
    decks: 6,
    dealMode: DEAL_MODES.ENHC,
    dealerPeek: false,
    dealerHitsSoft17: false,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.ALL_BETS_LOST,
    splitPairing: SPLIT_PAIRING.IDENTICAL_RANK,
  }),

  LAS_VEGAS_STRIP: defineProfile({
    id: 'LAS_VEGAS_STRIP',
    decks: 6,
    dealMode: DEAL_MODES.AMERICAN_HOLE_CARD,
    dealerPeek: true,
    dealerHitsSoft17: false,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.PEEK_PROTECTED,
  }),

  ATLANTIC_CITY: defineProfile({
    id: 'ATLANTIC_CITY',
    decks: 8,
    dealMode: DEAL_MODES.AMERICAN_HOLE_CARD,
    dealerPeek: true,
    dealerHitsSoft17: false,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.PEEK_PROTECTED,
    surrender: SURRENDER_MODES.LATE_SURRENDER,
    surrenderVsAce: true,
  }),

  VEGAS_DOWNTOWN: defineProfile({
    id: 'VEGAS_DOWNTOWN',
    decks: 2,
    dealMode: DEAL_MODES.AMERICAN_HOLE_CARD,
    dealerPeek: true,
    dealerHitsSoft17: true,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.PEEK_PROTECTED,
  }),

  SINGLE_DECK_3_2: defineProfile({
    id: 'SINGLE_DECK_3_2',
    decks: 1,
    dealMode: DEAL_MODES.AMERICAN_HOLE_CARD,
    dealerPeek: true,
    dealerHitsSoft17: true,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.PEEK_PROTECTED,
    doubleAfterSplit: false,
    penetration: 0.6,
  }),

  BLACKJACK_6_5: defineProfile({
    id: 'BLACKJACK_6_5',
    decks: 6,
    dealMode: DEAL_MODES.AMERICAN_HOLE_CARD,
    dealerPeek: true,
    dealerHitsSoft17: true,
    dealerBlackjackLossMode: DEALER_BJ_LOSS_MODES.PEEK_PROTECTED,
    blackjackPayout: Object.freeze({ numerator: 6, denominator: 5 }),
  }),
});

export const DEFAULT_PROFILE_ID = 'FRENCH_STANDARD';

/** Profile ids shown in the profile selector, in display order. */
export const PROFILE_IDS = Object.freeze([
  'FRENCH_STANDARD',
  'EUROPEAN_ENHC',
  'LAS_VEGAS_STRIP',
  'ATLANTIC_CITY',
  'VEGAS_DOWNTOWN',
  'SINGLE_DECK_3_2',
  'BLACKJACK_6_5',
  'CUSTOM',
]);

/** Settings the CUSTOM editor may change, with their allowed values. */
export const CUSTOM_EDITABLE_FIELDS = Object.freeze({
  decks: [1, 2, 4, 6, 8],
  dealMode: Object.values(DEAL_MODES),
  dealerHitsSoft17: [false, true],
  blackjackPayout: ['3:2', '6:5'],
  insuranceEnabled: [true, false],
  surrender: Object.values(SURRENDER_MODES),
  surrenderVsAce: [false, true],
  doubleRestriction: Object.values(DOUBLE_RESTRICTIONS),
  doubleAfterSplit: [true, false],
  maxSplitHands: [2, 3, 4],
  splitPairing: Object.values(SPLIT_PAIRING),
  resplitAces: [false, true],
  dealerBlackjackLossMode: Object.values(DEALER_BJ_LOSS_MODES),
});

const PAYOUT_STRINGS = Object.freeze({
  '3:2': Object.freeze({ numerator: 3, denominator: 2 }),
  '6:5': Object.freeze({ numerator: 6, denominator: 5 }),
});

/**
 * Build a validated CUSTOM profile from a plain settings object
 * (as produced by the custom-profile editor or restored from storage).
 * @param {object} settings
 * @returns {object} a frozen profile
 */
export function buildCustomProfile(settings) {
  const profile = {
    ...PROFILES.FRENCH_STANDARD,
    id: 'CUSTOM',
    ...settings,
  };
  if (typeof settings.blackjackPayout === 'string') {
    profile.blackjackPayout = PAYOUT_STRINGS[settings.blackjackPayout];
  }
  // Peek is implied by the deal mode in the custom editor: American hole
  // card games peek, ENHC games cannot.
  profile.dealerPeek = profile.dealMode === DEAL_MODES.AMERICAN_HOLE_CARD;
  if (profile.dealMode === DEAL_MODES.ENHC
    && profile.dealerBlackjackLossMode === DEALER_BJ_LOSS_MODES.PEEK_PROTECTED) {
    profile.dealerBlackjackLossMode = DEALER_BJ_LOSS_MODES.ALL_BETS_LOST;
  }
  if (profile.dealMode === DEAL_MODES.AMERICAN_HOLE_CARD) {
    profile.dealerBlackjackLossMode = DEALER_BJ_LOSS_MODES.PEEK_PROTECTED;
  }
  // Late surrender requires dealer blackjack to be ruled out first,
  // which needs a peek. Under ENHC only early surrender is coherent.
  if (profile.dealMode === DEAL_MODES.ENHC
    && profile.surrender === SURRENDER_MODES.LATE_SURRENDER) {
    profile.surrender = SURRENDER_MODES.EARLY_SURRENDER;
  }
  const frozen = Object.freeze(profile);
  validateProfile(frozen);
  return frozen;
}

/**
 * Validate a profile's internal coherence. Throws on any contradiction.
 * @param {object} profile
 */
export function validateProfile(profile) {
  const fail = (msg) => {
    throw new Error(`Invalid profile ${profile.id ?? '?'}: ${msg}`);
  };
  if (!Number.isInteger(profile.decks) || profile.decks < 1 || profile.decks > 8) {
    fail(`deck count ${profile.decks}`);
  }
  if (!Object.values(DEAL_MODES).includes(profile.dealMode)) fail(`deal mode ${profile.dealMode}`);
  if (!Object.values(SURRENDER_MODES).includes(profile.surrender)) fail(`surrender ${profile.surrender}`);
  if (!Object.values(SPLIT_PAIRING).includes(profile.splitPairing)) fail(`pairing ${profile.splitPairing}`);
  if (!Object.values(DOUBLE_RESTRICTIONS).includes(profile.doubleRestriction)) {
    fail(`double restriction ${profile.doubleRestriction}`);
  }
  if (!Object.values(DEALER_BJ_LOSS_MODES).includes(profile.dealerBlackjackLossMode)) {
    fail(`loss mode ${profile.dealerBlackjackLossMode}`);
  }
  if (profile.dealMode === DEAL_MODES.ENHC && profile.dealerPeek) {
    fail('ENHC games have no hole card to peek at');
  }
  if (profile.dealerBlackjackLossMode === DEALER_BJ_LOSS_MODES.PEEK_PROTECTED && !profile.dealerPeek) {
    fail('PEEK_PROTECTED requires dealer peek');
  }
  if (profile.surrender === SURRENDER_MODES.LATE_SURRENDER && !profile.dealerPeek) {
    fail('late surrender requires dealer peek');
  }
  if (![2, 3, 4].includes(profile.maxSplitHands)) fail(`max split hands ${profile.maxSplitHands}`);
  for (const ratio of [profile.blackjackPayout, profile.normalWinPayout, profile.insurancePayout]) {
    if (!ratio || !Number.isInteger(ratio.numerator) || !Number.isInteger(ratio.denominator)
      || ratio.numerator < 1 || ratio.denominator < 1) {
      fail('malformed payout ratio');
    }
  }
}

/**
 * Resolve a profile id (plus optional custom settings) to a validated profile.
 * @param {string} id
 * @param {object|null} [customSettings]
 * @returns {object}
 */
export function getProfile(id, customSettings = null) {
  if (id === 'CUSTOM') return buildCustomProfile(customSettings ?? {});
  const profile = PROFILES[id];
  if (!profile) throw new Error(`Unsupported profile: ${id}`);
  validateProfile(profile);
  return profile;
}
