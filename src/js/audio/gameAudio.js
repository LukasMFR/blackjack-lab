import { ACTIONS, HAND_STATUS, RESULTS, ROUND_STATES } from '../game/constants.js';

/**
 * Game-event → sound director.
 *
 * The app controller calls these semantic hooks; card, bust, and result
 * sounds are derived by diffing engine snapshots (structured data such as card
 * ids, statuses and round state, never rendered text). The blackjack
 * engine itself is untouched.
 */

const CARD_STAGGER_SEC = 0.14;
const RESULT_EXTRA_DELAY_SEC = 0.45;

/**
 * Which single result sound a completed round deserves.
 * Exactly one result sound plays per resolved round.
 * @param {object} snapshot - engine snapshot in ROUND_COMPLETE state
 * @returns {string} a manifest sound key
 */
export function resultSoundKey(snapshot) {
  const net = snapshot.roundSummary?.netCents ?? 0;
  if (net > 0) {
    return snapshot.hands.some((h) => h.result === RESULTS.BLACKJACK_WIN)
      ? 'resultBlackjack'
      : 'resultWin';
  }
  if (net === 0) return 'resultPush';
  const allBust = snapshot.hands.length > 0
    && snapshot.hands.every((h) => h.status === HAND_STATUS.BUST);
  return allBust ? 'bust' : 'resultLoss';
}

/**
 * @param {import('./audioManager.js').AudioManager} manager
 * @returns {object} the game-audio event surface
 */
export function createGameAudio(manager) {
  const seenCardIds = new Set();
  let resultPlayedForRound = false;

  /** Collect ids of every currently visible card in a snapshot. */
  function collectNewCards(snapshot) {
    const fresh = [];
    for (const hand of snapshot.hands) {
      for (const card of hand.cards) {
        if (!card.hidden && card.id && !seenCardIds.has(card.id)) {
          seenCardIds.add(card.id);
          fresh.push(card.id);
        }
      }
    }
    for (const card of snapshot.dealer.cards) {
      if (!card.hidden && card.id && !seenCardIds.has(card.id)) {
        seenCardIds.add(card.id);
        fresh.push(card.id);
      }
    }
    return fresh;
  }

  return {
    /** A new round is being dealt: forget the previous round's cards. */
    roundStarted() {
      seenCardIds.clear();
      resultPlayedForRound = false;
    },

    chipAdded() { manager.playSound('chipAdd'); },
    betCleared() { manager.playSound('chipCollide'); },
    rebet() { manager.playSound('chipHandle'); },

    /** The Deal button was accepted: the bet slides into the box. */
    dealConfirmed(justShuffled) {
      manager.playSound('chipStack');
      if (justShuffled) manager.playSound('shuffle', { delay: 0.1 });
    },

    /** A legal player action was accepted (its cards arrive via the diff). */
    actionAccepted(action) {
      switch (action) {
        case ACTIONS.STAND: manager.playSound('knock'); break;
        case ACTIONS.DOUBLE: manager.playSound('chipStack'); break;
        case ACTIONS.SPLIT: manager.playSound('chipCollide'); break;
        case ACTIONS.SURRENDER: manager.playSound('cardShove'); break;
        default: break; // HIT is voiced by its card
      }
    },

    actionRejected() { manager.playSound('uiInvalid'); },

    insuranceDecided(accepted) {
      manager.playSound(accepted ? 'chipAdd' : 'uiClick');
    },
    earlySurrenderDecided(accepted) {
      manager.playSound(accepted ? 'cardShove' : 'uiClick');
    },

    /** The table is cleared for the next round. */
    roundCleared() { manager.playSound('cardShove', { gainScale: 0.7 }); },
    bankrollReset() { manager.playSound('chipHandle'); },

    dialogOpened() { manager.playSound('uiOpen'); },
    dialogClosed() { manager.playSound('uiClose'); },
    settingChanged() { manager.playSound('uiToggle'); },
    uiClick() { manager.playSound('uiClick'); },

    /**
     * Voice the difference between two engine snapshots: newly dealt
     * cards, the hole-card reveal, fresh busts and, exactly once per
     * round on the edge into ROUND_COMPLETE, the round's result sound.
     * @param {object} before - snapshot taken before the mutation
     * @param {object} after - snapshot taken after the mutation
     * @param {{baseDelay?: number}} [options]
     */
    roundTransition(before, after, { baseDelay = 0 } = {}) {
      let delay = baseDelay;

      // Hole-card reveal is a distinct, snappier flip.
      const holeRevealed = before.dealer.holeCardHidden && !after.dealer.holeCardHidden
        && after.dealer.cards.length >= 2;
      if (holeRevealed && after.dealer.cards[1]?.id) {
        seenCardIds.add(after.dealer.cards[1].id);
        manager.playSound('cardReveal', { delay });
        delay += CARD_STAGGER_SEC;
      }

      for (const cardId of collectNewCards(after)) {
        void cardId;
        manager.playSound('cardDeal', { delay });
        delay += CARD_STAGGER_SEC;
      }

      // Fresh player busts get their muted thud while the round is
      // still going; a bust that ends the round is voiced by the result.
      if (after.roundState !== ROUND_STATES.ROUND_COMPLETE) {
        const bustedNow = after.hands.some((hand) => {
          const prev = before.hands.find((h) => h.id === hand.id);
          return hand.status === HAND_STATUS.BUST && prev?.status !== HAND_STATUS.BUST;
        });
        if (bustedNow) manager.playSound('bust', { delay });
      }

      const completedNow = after.roundState === ROUND_STATES.ROUND_COMPLETE
        && before.roundState !== ROUND_STATES.ROUND_COMPLETE;
      if (completedNow && !resultPlayedForRound) {
        resultPlayedForRound = true;
        const dealerBusted = after.dealer.evaluation?.isBust === true;
        if (dealerBusted) {
          manager.playSound('bust', { delay, gainScale: 0.8 });
          delay += 0.25;
        }
        manager.playSound(resultSoundKey(after), { delay: delay + RESULT_EXTRA_DELAY_SEC });
      }
    },
  };
}
