import { BlackjackGame } from '../game/engine.js';
import { ACTIONS, RESULTS, ROUND_STATES } from '../game/constants.js';
import { unitsToCents } from '../game/money.js';
import { buildCustomProfile, DEFAULT_PROFILE_ID, PROFILE_IDS, PROFILES } from '../config/profiles.js';
import {
  detectLanguage, getLanguage, setLanguage as setI18nLanguage, t,
} from '../i18n/index.js';
import * as storage from './storage.js';
import { AudioManager } from '../audio/audioManager.js';
import { createGameAudio } from '../audio/gameAudio.js';
import { AUDIO_SETTINGS_KEY, sanitizeAudioSettings } from '../audio/audioSettings.js';
import { formatMoney } from './format.js';
import { cardLabel } from './cardView.js';
import { profileSummaryChips } from './profileSummary.js';
import {
  announce, renderHistory, renderPanels, renderSession, renderStaticLabels, renderTable, showToast,
} from './render.js';
import { initSettingsView } from './settingsView.js';
import { loadStartingBankrollCents, saveStartingBankrollCents } from './bankrollSettings.js';
import { initLanguageMenu, setLanguageMenuValue } from './languageMenu.js';

/**
 * Application controller: owns the engine instance, user preferences,
 * bet composition, history, and event wiring. All rule decisions live in
 * the engine; this file only orchestrates.
 */

const $ = (id) => document.getElementById(id);

const CHIP_VALUES = [5, 10, 25, 50, 100, 500];

const state = {
  language: 'en',
  appearance: 'system', // 'system' | 'light' | 'dark'
  theme: 'classic', // 'classic' | 'minimal' | 'salon'
  profileId: DEFAULT_PROFILE_ID,
  customSettings: null,
  customProfile: null,
  activeProfile: null,
  game: null,
  betCents: 0,
  history: [],
  roundCounter: 0,
  sessionNetCents: 0,
  roundRecorded: false,
};

const renderCtx = { seenCardIds: new Set(), prevHoleHidden: false };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/* ---------------------------------------------------------------- audio */

const audioManager = new AudioManager({
  settings: sanitizeAudioSettings(storage.getObject(AUDIO_SETTINGS_KEY)),
  persist: (settings) => storage.setObject(AUDIO_SETTINGS_KEY, settings),
});
const gameAudio = createGameAudio(audioManager);

/** Header speaker button: reflect enabled/muted state and localized labels. */
function updateSoundButton() {
  const button = $('btn-sound');
  const settings = audioManager.settings;
  const silent = !settings.enabled || settings.muted;
  // toggleAttribute: SVG elements have no HTMLElement `hidden` property.
  button.querySelector('.icon-sound-on').toggleAttribute('hidden', silent);
  button.querySelector('.icon-sound-off').toggleAttribute('hidden', !silent);
  const label = silent ? t('a11y.unmute') : t('a11y.mute');
  const stateText = silent ? t('settings.audioOff') : t('settings.audioOn');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(silent));
  button.title = stateText;
}

function toggleSound() {
  audioManager.toggleMuted();
  updateSoundButton();
  const silent = audioManager.effectivelySilent;
  announce(silent ? t('settings.audioOff') : t('settings.audioOn'));
  if (!silent) gameAudio.uiClick();
}

/* ------------------------------------------------------------ preferences */

function loadPreferences() {
  const storedLanguage = storage.getChoice('language', ['en', 'fr'], null);
  state.language = storedLanguage ?? detectLanguage();
  setI18nLanguage(state.language);

  state.appearance = storage.getChoice('appearance', ['system', 'light', 'dark'], 'system');
  state.theme = storage.getChoice('theme', ['classic', 'minimal', 'salon'], 'classic');
  state.profileId = storage.getChoice('profile', PROFILE_IDS, DEFAULT_PROFILE_ID);
  state.customSettings = storage.getObject('customProfile');

  if (state.profileId === 'CUSTOM') {
    try {
      state.customProfile = buildCustomProfile(state.customSettings ?? {});
    } catch (error) {
      console.error('Stored custom profile rejected:', error);
      showToast(t('errors.corruptSave'));
      state.profileId = DEFAULT_PROFILE_ID;
      state.customSettings = null;
    }
  } else if (state.customSettings) {
    try {
      state.customProfile = buildCustomProfile(state.customSettings);
    } catch {
      state.customSettings = null;
    }
  }
}

function applyAppearance() {
  const mode = state.appearance === 'system'
    ? (darkQuery.matches ? 'dark' : 'light')
    : state.appearance;
  document.documentElement.dataset.mode = mode;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

darkQuery.addEventListener('change', () => {
  if (state.appearance === 'system') applyAppearance();
});

/* ------------------------------------------------------------------ game */

function resolveProfile() {
  if (state.profileId === 'CUSTOM') {
    state.customProfile = buildCustomProfile(state.customSettings ?? {});
    return state.customProfile;
  }
  return PROFILES[state.profileId];
}

function bankrollKey() {
  return `bankroll.${state.profileId}`;
}

/**
 * The bankroll a fresh session starts from: the player's stored choice for
 * this profile, else the profile's own default.
 * @returns {number} cents
 */
function startingBankrollCents() {
  const profile = state.activeProfile ?? resolveProfile();
  return loadStartingBankrollCents(state.profileId, unitsToCents(profile.startingBankrollUnits));
}

function createGame() {
  const profile = resolveProfile();
  state.activeProfile = profile;
  const savedBankroll = storage.getAmount(bankrollKey());
  state.game = new BlackjackGame({
    profile,
    bankrollCents: savedBankroll ?? startingBankrollCents(),
  });
  renderCtx.seenCardIds.clear();
  renderCtx.prevHoleHidden = false;
  state.betCents = clampBet(state.game.lastBetCents);
}

function clampBet(cents) {
  const budget = Math.min(state.game.bankrollCents, state.game.maxBetCents());
  if (cents > budget) return 0;
  return cents;
}

function persistBankroll() {
  const roundState = state.game.roundState;
  if (roundState === ROUND_STATES.WAITING_FOR_BET || roundState === ROUND_STATES.ROUND_COMPLETE) {
    storage.setAmount(bankrollKey(), state.game.bankrollCents);
  }
}

function isRoundActive() {
  const roundState = state.game.roundState;
  return roundState !== ROUND_STATES.WAITING_FOR_BET
    && roundState !== ROUND_STATES.ROUND_COMPLETE;
}

/* -------------------------------------------------------------- rendering */

function betState() {
  return {
    betCents: state.betCents,
    canRebet: state.game.lastBetCents >= state.game.minBetCents()
      && state.game.lastBetCents <= Math.min(state.game.bankrollCents, state.game.maxBetCents()),
    chipValues: CHIP_VALUES.filter((v) => unitsToCents(v) <= state.game.maxBetCents()),
    minBetCents: state.game.minBetCents(),
    maxBetCents: unitsToCents(state.activeProfile.maxBetUnits),
  };
}

function renderAll() {
  document.documentElement.lang = state.language;
  setLanguageMenuValue(state.language);
  renderStaticLabels();
  updateSoundButton();
  renderHeaderProfile();
  const snapshot = state.game.getSnapshot();
  renderTable(snapshot, renderCtx);
  renderPanels(snapshot, betState());
  renderHistory(state.history.map((entry) => ({
    ...entry,
    labels: entry.results.map((r) => t(`results.${r}`))
      .concat(entry.insurance ? [t('history.insurance')] : []),
  })));
  renderSession({ rounds: state.roundCounter, netCents: state.sessionNetCents });
}

function renderHeaderProfile() {
  $('profile-chip-name').textContent = t(`profiles.${state.profileId}.name`);
  const chips = profileSummaryChips(state.activeProfile);
  // One rule per line; the sidebar card has room for the full summary.
  $('profile-chip-meta').textContent = chips.join('\n');
  $('btn-profile').setAttribute('aria-label', `${t('nav.profile')}: ${t(`profiles.${state.profileId}.name`)}`);
}

/* ---------------------------------------------------------- announcements */

function announceAfterDeal(snapshot) {
  const parts = [];
  const hand = snapshot.hands[0];
  for (const card of hand.cards) {
    parts.push(t('a11y.dealtCard', { who: t('hand.you'), card: cardLabel(card) }));
  }
  const upcard = snapshot.dealer.cards[0];
  if (upcard && !upcard.hidden) {
    parts.push(t('a11y.dealtCard', { who: t('hand.dealer'), card: cardLabel(upcard) }));
  }
  parts.push(t('a11y.totalIs', { who: t('hand.you'), total: hand.evaluation.total }));
  announce(parts.join(' '));
}

function announceAfterAction(before, after) {
  const parts = [];
  after.hands.forEach((hand, index) => {
    const prev = before.hands.find((h) => h.id === hand.id);
    const prevCount = prev ? prev.cards.length : 0;
    for (const card of hand.cards.slice(prevCount)) {
      parts.push(t('a11y.dealtCard', { who: t('hand.you'), card: cardLabel(card) }));
    }
    if (hand.isActive || (prev && hand.cards.length !== prevCount)) {
      parts.push(t('a11y.totalIs', {
        who: after.hands.length > 1 ? t('hand.handN', { n: index + 1 }) : t('hand.you'),
        total: hand.evaluation.total,
      }));
    }
  });
  const prevDealerVisible = before.dealer.cards.filter((c) => !c.hidden).length;
  after.dealer.cards.forEach((card, index) => {
    if (card.hidden) return;
    if (index >= prevDealerVisible || (before.dealer.cards[index]?.hidden && !card.hidden)) {
      parts.push(t('a11y.dealerReveals', { card: cardLabel(card) }));
    }
  });
  if (after.dealer.cards.length > 0 && !after.dealer.holeCardHidden
    && after.roundState === ROUND_STATES.ROUND_COMPLETE) {
    parts.push(t('a11y.totalIs', { who: t('hand.dealer'), total: after.dealer.evaluation.total }));
  }
  if (after.roundState === ROUND_STATES.ROUND_COMPLETE) {
    parts.push(roundOutcomeText(after));
  }
  announce(parts.join(' '));
}

function roundOutcomeText(snapshot) {
  const net = snapshot.roundSummary?.netCents ?? 0;
  let text;
  if (net > 0) text = t('results.netWin', { amount: formatMoney(net) });
  else if (net < 0) text = t('results.netLoss', { amount: `-${formatMoney(-net)}` });
  else text = t('results.netEven');
  if (snapshot.insurance.taken) {
    text += ` ${snapshot.insurance.result === RESULTS.WIN
      ? t('insurance.won', { amount: formatMoney(snapshot.insurance.betCents * 3) })
      : t('insurance.lost', { amount: formatMoney(snapshot.insurance.betCents) })}`;
  }
  return text;
}

/* -------------------------------------------------------------- mutations */

/**
 * Run an engine mutation, then handle persistence, history, announcements
 * and rendering. Engine errors surface as a toast without corrupting state.
 */
function mutate(fn, { announceDiff = true } = {}) {
  const before = state.game.getSnapshot();
  try {
    fn();
  } catch (error) {
    console.error(error);
    showToast(t('errors.generic'));
    gameAudio.actionRejected();
    return;
  }
  const after = state.game.getSnapshot();
  gameAudio.roundTransition(before, after);
  if (after.roundState === ROUND_STATES.ROUND_COMPLETE && !state.roundRecorded) {
    state.roundRecorded = true;
    state.roundCounter += 1;
    state.sessionNetCents += after.roundSummary.netCents;
    state.history.push({
      n: state.roundCounter,
      netCents: after.roundSummary.netCents,
      results: after.hands.map((hand) => hand.result),
      insurance: after.insurance.taken,
    });
    if (state.history.length > 30) state.history.shift();
    persistBankroll();
  }
  if (announceDiff) announceAfterAction(before, after);
  renderAll();
}

function deal() {
  const snapshot = state.game.getSnapshot();
  if (snapshot.roundState !== ROUND_STATES.WAITING_FOR_BET) return;
  if (state.betCents < state.game.minBetCents()
    || state.betCents > Math.min(state.game.bankrollCents, state.game.maxBetCents())) {
    return;
  }
  renderCtx.seenCardIds.clear();
  renderCtx.prevHoleHidden = false;
  state.roundRecorded = false;
  const bet = state.betCents;
  const before = state.game.getSnapshot();
  try {
    state.game.placeBet(bet);
  } catch (error) {
    console.error(error);
    showToast(t('errors.generic'));
    gameAudio.actionRejected();
    return;
  }
  const after = state.game.getSnapshot();
  gameAudio.roundStarted();
  gameAudio.dealConfirmed(after.shoe.justShuffled);
  gameAudio.roundTransition(before, after, { baseDelay: 0.25 });
  if (after.shoe.justShuffled) showToast(t('round.shuffled'));
  if (after.roundState === ROUND_STATES.ROUND_COMPLETE && !state.roundRecorded) {
    // Instant resolution (e.g. peeked dealer blackjack, immediate natural).
    state.roundRecorded = true;
    state.roundCounter += 1;
    state.sessionNetCents += after.roundSummary.netCents;
    state.history.push({
      n: state.roundCounter,
      netCents: after.roundSummary.netCents,
      results: after.hands.map((hand) => hand.result),
      insurance: after.insurance.taken,
    });
    persistBankroll();
    announceAfterAction(before, after);
  } else {
    announceAfterDeal(after);
  }
  renderAll();
}

function nextRound() {
  gameAudio.roundCleared();
  mutate(() => {
    state.game.nextRound();
    state.betCents = clampBet(state.game.lastBetCents);
    persistBankroll();
  }, { announceDiff: false });
  announce(t('bet.placeYourBet'));
}

/** Shared path for action buttons and keyboard shortcuts. */
function performAction(action) {
  gameAudio.actionAccepted(action);
  mutate(() => state.game.act(action));
}

/* ------------------------------------------------------------- controller */

const controller = {
  getState: () => state,
  isRoundActive,
  setLanguage(language) {
    state.language = language;
    setI18nLanguage(language);
    storage.setChoice('language', language);
    renderAll();
  },
  setAppearance(appearance) {
    state.appearance = appearance;
    storage.setChoice('appearance', appearance);
    applyAppearance();
  },
  setTheme(theme) {
    state.theme = theme;
    storage.setChoice('theme', theme);
    applyTheme();
  },
  setProfile(profileId) {
    if (isRoundActive() || profileId === state.profileId) return;
    try {
      persistBankroll();
      state.profileId = profileId;
      storage.setChoice('profile', profileId);
      createGame();
      renderAll();
    } catch (error) {
      console.error(error);
      showToast(t('errors.generic'));
      state.profileId = DEFAULT_PROFILE_ID;
      createGame();
      renderAll();
    }
  },
  applyCustomSettings(settings) {
    if (isRoundActive()) return;
    try {
      state.customProfile = buildCustomProfile(settings);
      state.customSettings = settings;
      storage.setObject('customProfile', settings);
      if (state.profileId === 'CUSTOM') {
        persistBankroll();
        createGame();
        renderAll();
      }
    } catch (error) {
      console.error(error);
      showToast(t('errors.generic'));
    }
  },
  getStartingBankrollCents: () => startingBankrollCents(),
  /**
   * Apply a new starting bankroll for the active profile. This is a session
   * boundary: the live bankroll, the round history and the session total all
   * restart from the new amount.
   * @param {number} cents
   */
  setStartingBankroll(cents) {
    if (isRoundActive()) return;
    try {
      saveStartingBankrollCents(state.profileId, cents);
    } catch (error) {
      console.error(error);
      showToast(t('errors.generic'));
      return;
    }
    storage.clear(bankrollKey());
    state.history = [];
    state.roundCounter = 0;
    state.sessionNetCents = 0;
    createGame();
    persistBankroll();
    renderAll();
    gameAudio.bankrollReset();
    showToast(t('settings.bankrollApplied', { amount: formatMoney(cents) }));
    announce(t('settings.bankrollApplied', { amount: formatMoney(cents) }));
  },

  /* ------------------------------------------------------------- audio */

  audio: gameAudio,
  audioSupported: () => audioManager.supported,
  getAudioSettings: () => audioManager.settings,
  setAudioSettings(patch) {
    audioManager.updateSettings(patch);
    updateSoundButton();
  },
  toggleAudioMuted() {
    toggleSound();
  },
  restoreAudioDefaults() {
    audioManager.restoreDefaults();
    updateSoundButton();
  },
  playTestSound: () => audioManager.playTestSound(),
};

/* ----------------------------------------------------------------- events */

function wireEvents() {
  // Browsers only allow audio after a genuine gesture: the first pointer
  // press or key press unlocks the audio context (idempotent).
  const unlockAudio = () => audioManager.unlock();
  document.addEventListener('pointerdown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });
  document.addEventListener('click', unlockAudio, { capture: true });
  audioManager.bindVisibility(document);

  $('btn-sound').addEventListener('click', toggleSound);

  initLanguageMenu({
    onSelect: (language) => {
      controller.setLanguage(language);
      gameAudio.settingChanged();
    },
  });

  $('chip-row').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip || chip.disabled) return;
    state.betCents += unitsToCents(Number(chip.dataset.value));
    gameAudio.chipAdded();
    renderAll();
  });

  $('btn-clear').addEventListener('click', () => {
    if (state.betCents > 0) gameAudio.betCleared();
    state.betCents = 0;
    renderAll();
  });

  $('btn-rebet').addEventListener('click', () => {
    state.betCents = clampBet(state.game.lastBetCents);
    if (state.betCents > 0) gameAudio.rebet();
    renderAll();
  });

  $('btn-deal').addEventListener('click', deal);
  $('btn-next').addEventListener('click', nextRound);

  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') {
        gameAudio.actionRejected();
        return;
      }
      performAction(button.dataset.action);
    });
  }

  $('btn-decision-yes').addEventListener('click', () => decide(true));
  $('btn-decision-no').addEventListener('click', () => decide(false));

  document.addEventListener('keydown', handleShortcut);
}

function decide(accept) {
  const snapshot = state.game.getSnapshot();
  if (snapshot.pendingDecision === 'INSURANCE') {
    gameAudio.insuranceDecided(accept);
    mutate(() => state.game.decideInsurance(accept));
  } else if (snapshot.pendingDecision === 'EARLY_SURRENDER') {
    gameAudio.earlySurrenderDecided(accept);
    mutate(() => state.game.decideEarlySurrender(accept));
  }
}

const SHORTCUTS = {
  h: ACTIONS.HIT,
  s: ACTIONS.STAND,
  d: ACTIONS.DOUBLE,
  p: ACTIONS.SPLIT,
  r: ACTIONS.SURRENDER,
};

function handleShortcut(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const target = event.target;
  if (target instanceof HTMLElement
    && (target.closest('input, select, textarea') || target.isContentEditable)) {
    return;
  }
  const key = event.key.toLowerCase();
  const snapshot = state.game.getSnapshot();
  if (key === 'n') {
    if (snapshot.roundState === ROUND_STATES.WAITING_FOR_BET) deal();
    else if (snapshot.roundState === ROUND_STATES.ROUND_COMPLETE) nextRound();
    return;
  }
  const action = SHORTCUTS[key];
  if (!action) return;
  if (snapshot.roundState !== ROUND_STATES.PLAYER_TURN || snapshot.pendingDecision) return;
  if (!snapshot.actionAvailability[action]?.legal) {
    gameAudio.actionRejected();
    return;
  }
  performAction(action);
}

/* ------------------------------------------------------------------- boot */

function boot() {
  loadPreferences();
  applyAppearance();
  applyTheme();
  try {
    createGame();
  } catch (error) {
    console.error(error);
    state.profileId = DEFAULT_PROFILE_ID;
    state.customSettings = null;
    createGame();
  }
  initSettingsView(controller);
  wireEvents();
  renderAll();
  storage.setChoice('language', state.language);
}

boot();
