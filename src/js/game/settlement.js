import { RESULTS } from './constants.js';
import { exactHalf, exactProfit } from './money.js';

/**
 * Pure comparison and payout rules. The engine owns *when* a hand is
 * settled; this module owns *what* the outcome is worth. There is no
 * other payout implementation anywhere in the project.
 */

/**
 * Compare a non-bust, non-surrendered player hand against the finished
 * dealer hand.
 * @param {{total: number, isBlackjack: boolean}} playerHand
 * @param {{total: number, isBust: boolean, isBlackjack: boolean}} dealer
 * @returns {string} a RESULTS value
 */
export function compareHands(playerHand, dealer) {
  if (playerHand.isBlackjack && dealer.isBlackjack) return RESULTS.PUSH;
  if (playerHand.isBlackjack) return RESULTS.BLACKJACK_WIN;
  if (dealer.isBlackjack) return RESULTS.LOSS;
  if (dealer.isBust) return RESULTS.WIN;
  if (playerHand.total > dealer.total) return RESULTS.WIN;
  if (playerHand.total < dealer.total) return RESULTS.LOSS;
  return RESULTS.PUSH;
}

/**
 * Total amount returned to the bankroll for a settled hand
 * (stake + profit; 0 for a loss).
 * @param {string} result - a RESULTS value
 * @param {number} betCents - full committed bet on the hand
 * @param {object} profile - active rule profile
 * @returns {number} cents returned
 */
export function payoutForResult(result, betCents, profile) {
  switch (result) {
    case RESULTS.WIN:
      return betCents + exactProfit(betCents, profile.normalWinPayout);
    case RESULTS.BLACKJACK_WIN:
      return betCents + exactProfit(betCents, profile.blackjackPayout);
    case RESULTS.PUSH:
      return betCents;
    case RESULTS.SURRENDER:
      return exactHalf(betCents);
    case RESULTS.LOSS:
      return 0;
    default:
      throw new Error(`Unknown result: ${result}`);
  }
}
