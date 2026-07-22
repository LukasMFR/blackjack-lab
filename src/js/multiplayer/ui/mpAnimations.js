import { HAND_STATUS, RESULTS } from '../../game/constants.js';
import { TABLE_STATES } from '../tableEngine.js';
import { getAnimationMode } from '../../ui/animations.js';
import {
  animateMoney, cancelCounters, captureCardRects, clearGhosts, flipMovedCards,
  flyChip, flyChips, ghostCardsToDiscard, staggerDealtCards,
} from '../../ui/motion.js';

/**
 * Motion director for the multiplayer room: the enhanced-mode counterpart
 * of ui/animations.js, driven by confirmed host table snapshots instead of
 * engine snapshots. Every seat gets card flights, FLIP moves, bust dims
 * and result glows; chip flights touch the local status strip only for the
 * local seat (the bankroll and bet displays are theirs), while other
 * seats settle against the dealer area. The mode itself (enhanced by
 * default) is resolved by ui/animations.js onto <html data-anim>.
 */

const $ = (id) => document.getElementById(id);

/* Mirror playSnapshotAudio's 0.12 s card stagger and 0.35 s result delay
   in mpApp.js, so every flight lands on its sound. */
const CARD_STAGGER_MS = 120;
const RESULT_EXTRA_DELAY_MS = 350;

const FX_BY_RESULT = {
  [RESULTS.WIN]: 'hand--fx-win',
  [RESULTS.BLACKJACK_WIN]: 'hand--fx-blackjack',
  [RESULTS.PUSH]: 'hand--fx-push',
  [RESULTS.SURRENDER]: 'hand--fx-push',
  [RESULTS.LOSS]: 'hand--fx-loss',
};

let prevTable = null;
let prevRects = null; // card id -> DOMRect, captured just before a render
let shownBankrollCents = null;
let shownBetCents = null;

function cardEls() {
  return document.querySelectorAll('#mp-table [data-card-id]');
}

/** Forget everything between sessions (new room, restore, leave). */
export function resetMotionMemory() {
  clearGhosts();
  cancelCounters();
  prevTable = null;
  prevRects = null;
  shownBankrollCents = null;
  shownBetCents = null;
}

/** A bet chip was pressed: it flies from the rack to the bet display. */
export function mpChipAdded(chipEl) {
  if (getAnimationMode() !== 'enhanced') return;
  flyChip({
    from: chipEl.getBoundingClientRect(),
    to: $('mp-bet-value').getBoundingClientRect(),
    color: getComputedStyle(chipEl).getPropertyValue('--chip-color').trim() || null,
    durationMs: 440,
  });
}

/** The composed bet was cleared: chips return to the rack. */
export function mpBetCleared() {
  if (getAnimationMode() !== 'enhanced') return;
  flyChips({
    from: $('mp-bet-value').getBoundingClientRect(),
    to: $('mp-chip-row').getBoundingClientRect(),
    count: 2,
  });
}

/**
 * Capture the pre-render world. Called with the incoming snapshot's table
 * while the DOM still shows the previous one: card rects feed the FLIP
 * pass, and a round clearing back to betting ghosts the old cards off
 * toward the discard — there is no local "next round" trigger on client
 * devices, so the transition is detected from the snapshot itself.
 * @param {object|null} nextTable - the table about to be rendered
 */
export function beforeMpRender(nextTable) {
  cancelCounters();
  prevRects = null;
  if (getAnimationMode() !== 'enhanced') return;
  if (prevTable && nextTable
    && prevTable.state === TABLE_STATES.ROUND_COMPLETE
    && nextTable.state === TABLE_STATES.BETTING) {
    ghostCardsToDiscard($('mp-table'), [...document.querySelectorAll('#mp-table .card')]);
  }
  prevRects = captureCardRects(cardEls());
}

/**
 * Decorate the freshly rendered table. Runs synchronously after the
 * render, before the browser paints, so nothing ever flashes.
 * @param {object} table - the table snapshot just rendered
 * @param {string|null} localPlayerId
 * @param {number} composedBetCents - the bet being composed locally
 */
export function afterMpRender(table, localPlayerId, composedBetCents) {
  const before = prevTable;
  prevTable = table;
  const seat = table.seats.find((s) => s.playerId === localPlayerId) ?? null;

  // One-shot classes on persistent nodes must reset on every render.
  $('mp-dealer-cards').classList.remove('cards--fx-dealer-bust');

  const betTarget = displayedBetCents(table, seat, composedBetCents);
  if (getAnimationMode() === 'enhanced') {
    flipMovedCards(cardEls(), prevRects);
    const cursorMs = staggerFreshCards();
    playTransitionEffects(table, before, seat, cursorMs, betTarget);
  }

  shownBankrollCents = seat ? seat.bankrollCents : null;
  shownBetCents = betTarget;
  prevRects = null;
}

/** Mirror of renderPanels' display logic for the local bet stat. */
function displayedBetCents(table, seat, composedBetCents) {
  if (!seat) return null;
  if (table.state === TABLE_STATES.BETTING) return seat.betCents || composedBetCents;
  return seat.hands.reduce((sum, hand) => sum + hand.betCents, 0)
    + (seat.insurance?.taken ? seat.insurance.betCents : 0);
}

/**
 * Stagger the newly dealt cards in the same order as the card sounds:
 * seats first, dealer after (see playSnapshotAudio in mpApp.js).
 * @returns {number} the delay cursor after the last card, in ms
 */
function staggerFreshCards() {
  return staggerDealtCards({
    tableEl: $('mp-table'),
    freshEls: [
      ...document.querySelectorAll('#mp-seats .card.is-dealt'),
      ...document.querySelectorAll('#mp-dealer-cards .card.is-dealt'),
    ],
    revealedEl: document.querySelector('#mp-dealer-cards .card.is-revealed'),
    staggerMs: CARD_STAGGER_MS,
  });
}

/** The rendered hand elements of each seat, in table.seats order. */
function seatHandEls() {
  return [...document.querySelectorAll('#mp-seats .mp-seat')]
    .map((seatEl) => [...seatEl.querySelectorAll('.hand')]);
}

/**
 * Everything derived from the before/after snapshot diff: the local
 * seat's committed-wager flights, every seat's bust dims and result
 * glows, chip settlements, and the local money count-ups.
 */
function playTransitionEffects(table, before, localSeat, cursorMs, betTarget) {
  const dealerRect = $('mp-dealer-cards').getBoundingClientRect();
  const bankrollEl = $('mp-bankroll-value');
  const bankrollRect = bankrollEl.getBoundingClientRect();
  const handElsBySeat = seatHandEls();

  const completedNow = before !== null
    && table.state === TABLE_STATES.ROUND_COMPLETE
    && before.state !== TABLE_STATES.ROUND_COMPLETE;
  const resultDelayMs = completedNow ? cursorMs + RESULT_EXTRA_DELAY_MS : null;

  if (completedNow && table.dealer.evaluation?.isBust === true) {
    const dealerCardsEl = $('mp-dealer-cards');
    dealerCardsEl.style.setProperty('--result-delay', `${cursorMs}ms`);
    dealerCardsEl.classList.add('cards--fx-dealer-bust');
  }

  table.seats.forEach((seat, seatIndex) => {
    const handEls = handElsBySeat[seatIndex] ?? [];
    const beforeSeat = before?.seats.find((s) => s.playerId === seat.playerId) ?? null;
    const isLocal = localSeat !== null && seat.playerId === localSeat.playerId;
    // Winnings land on the local bankroll display; every other seat
    // settles against the dealer, like across a real table.
    const payoutRect = isLocal ? bankrollRect : dealerRect;

    seat.hands.forEach((hand, index) => {
      const el = handEls[index];
      if (!el) return;
      const prev = beforeSeat?.hands.find((h) => h.id === hand.id);

      // Wagers committed since the last render: double, split. Only the
      // local seat's chips leave the local bankroll display.
      if (isLocal && before) {
        if (prev && hand.doubled && !prev.doubled) {
          flyChips({ from: bankrollRect, to: el.getBoundingClientRect(), count: 2 });
        } else if (!prev && hand.fromSplit) {
          flyChips({ from: bankrollRect, to: el.getBoundingClientRect(), count: 2 });
        }
      }

      // Hands that just busted dim in place and are collected.
      const newlyBusted = hand.status === HAND_STATUS.BUST
        && (!prev || prev.status !== HAND_STATUS.BUST);
      if (newlyBusted) {
        const delayMs = resultDelayMs ?? cursorMs;
        el.style.setProperty('--result-delay', `${delayMs}ms`);
        el.classList.add('hand--fx-bust');
        flyChips({
          from: el.getBoundingClientRect(), to: dealerRect, count: 2, delayMs: delayMs + 180,
        });
      }

      if (!completedNow || hand.status === HAND_STATUS.BUST) return;
      el.style.setProperty('--result-delay', `${resultDelayMs}ms`);
      const fx = FX_BY_RESULT[hand.result];
      if (fx) el.classList.add(fx);
      const handRect = el.getBoundingClientRect();
      switch (hand.result) {
        case RESULTS.BLACKJACK_WIN:
          flyChips({ from: handRect, to: payoutRect, count: 4, delayMs: resultDelayMs });
          break;
        case RESULTS.WIN:
          flyChips({ from: handRect, to: payoutRect, count: 3, delayMs: resultDelayMs });
          break;
        case RESULTS.PUSH:
          if (isLocal) flyChip({ from: handRect, to: payoutRect, delayMs: resultDelayMs });
          break;
        case RESULTS.SURRENDER:
          if (isLocal) flyChip({ from: handRect, to: bankrollRect, delayMs: resultDelayMs });
          flyChip({ from: handRect, to: dealerRect, delayMs: resultDelayMs });
          break;
        case RESULTS.LOSS:
          flyChips({ from: handRect, to: dealerRect, count: 2, delayMs: resultDelayMs });
          break;
        default:
          break;
      }
    });
  });

  if (localSeat && before) {
    const beforeLocal = before.seats.find((s) => s.playerId === localSeat.playerId);
    if (localSeat.insurance?.taken && !beforeLocal?.insurance?.taken) {
      flyChip({ from: bankrollRect, to: $('mp-bet-value').getBoundingClientRect() });
    }
    if (completedNow && localSeat.insurance?.taken
      && localSeat.insurance.result === RESULTS.WIN) {
      flyChips({ from: dealerRect, to: bankrollRect, count: 2, delayMs: resultDelayMs });
    }
  }

  // The local money displays count toward their rendered values; a payout
  // waits for its chips, a debit reacts immediately.
  if (localSeat) {
    const gain = shownBankrollCents !== null
      && localSeat.bankrollCents > shownBankrollCents;
    animateMoney(bankrollEl, shownBankrollCents, localSeat.bankrollCents,
      completedNow && gain ? resultDelayMs : 0);
    if (betTarget !== null) {
      animateMoney($('mp-bet-value'), shownBetCents, betTarget, 0);
    }
  }
}
