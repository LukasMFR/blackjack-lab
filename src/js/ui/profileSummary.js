import { t } from '../i18n/index.js';
import { formatRatio } from './format.js';
import { DEAL_MODES, DEALER_BJ_LOSS_MODES, SURRENDER_MODES } from '../game/constants.js';

/**
 * Short, translated rule summary for a profile, derived directly from the
 * profile configuration so the selector can never drift from the engine.
 * @param {object} profile
 * @returns {string[]} list of short summary chips
 */
export function profileSummaryChips(profile) {
  const chips = [];
  chips.push(profile.decks === 1 ? t('summary.oneDeck') : t('summary.decks', { count: profile.decks }));
  chips.push(profile.dealMode === DEAL_MODES.ENHC ? t('summary.enhc') : t('summary.holeCardPeek'));
  chips.push(profile.dealerHitsSoft17 ? t('summary.h17') : t('summary.s17'));
  chips.push(t('summary.bjPays', { ratio: formatRatio(profile.blackjackPayout) }));
  if (profile.surrender === SURRENDER_MODES.LATE_SURRENDER) chips.push(t('summary.lateSurrender'));
  else if (profile.surrender === SURRENDER_MODES.EARLY_SURRENDER) chips.push(t('summary.earlySurrender'));
  else chips.push(t('summary.noSurrender'));
  chips.push(profile.doubleAfterSplit ? t('summary.das') : t('summary.noDas'));
  if (profile.dealerBlackjackLossMode === DEALER_BJ_LOSS_MODES.ALL_BETS_LOST) {
    chips.push(t('summary.allBetsLost'));
  } else if (profile.dealerBlackjackLossMode === DEALER_BJ_LOSS_MODES.ORIGINAL_BETS_ONLY) {
    chips.push(t('summary.originalBetsOnly'));
  } else {
    chips.push(t('summary.peekProtected'));
  }
  return chips;
}
