import { detectLanguage, setLanguage as setI18nLanguage, t } from '../../i18n/index.js';
import * as storage from '../../ui/storage.js';
import { formatMoney } from '../../ui/format.js';
import { initLanguageMenu, setLanguageMenuValue } from '../../ui/languageMenu.js';
import { AudioManager } from '../../audio/audioManager.js';
import { AUDIO_SETTINGS_KEY, sanitizeAudioSettings } from '../../audio/audioSettings.js';
import { unitsToCents } from '../../game/money.js';
import { ACTIONS, SURRENDER_MODES } from '../../game/constants.js';
import { getProfile, PROFILE_IDS } from '../../config/profiles.js';
import { HostSession } from '../hostSession.js';
import { ClientSession } from '../clientSession.js';
import { MESSAGE_TYPES } from '../protocol.js';
import { ROOM_PHASES } from '../stateSync.js';
import { SEAT_DECISIONS, TABLE_STATES } from '../tableEngine.js';
import {
  acceptAnswer, createClientLink, createHostLink, isWebRtcSupported,
} from '../peerConnection.js';
import { decodeSignal, encodeSignal, SIGNAL_KINDS } from '../signalling.js';
import { qrSvg } from '../qr.js';
import { qrScanningSupported, startQrScanner } from '../qrScanner.js';
import {
  announce, renderMpHistory, renderMpTable, renderPlayerList, showToast,
} from './mpViews.js';

/**
 * Local multiplayer controller: screens, pairing wizard, and the render
 * loop over confirmed host snapshots. The blackjack rules live in the
 * table engine on the host; the network protocol lives in
 * multiplayer/*.js. This file only orchestrates the interface.
 */

const $ = (id) => document.getElementById(id);

const CHIP_VALUES = [5, 10, 25, 50, 100, 500];
const NAME_KEY = 'mp.playerName';
const RESUME_PREFIX = 'mp.resume.';

const state = {
  language: 'en',
  role: null, // 'host' | 'client'
  hostSession: null,
  clientSession: null,
  clientLink: null,
  inviteLink: null,
  invitePeerId: null,
  scanner: null,
  betCents: 0,
  lastPayload: null,
  seenCardIds: new Set(),
  prevHoleHidden: { value: false },
  audioSeenCards: new Set(),
  lastAnnouncedTurn: null,
  lastResultRound: 0,
};

/* --------------------------------------------------------------- audio */

const audioManager = new AudioManager({
  settings: sanitizeAudioSettings(storage.getObject(AUDIO_SETTINGS_KEY)),
  persist: (settings) => storage.setObject(AUDIO_SETTINGS_KEY, settings),
});

function updateSoundButton() {
  const button = $('btn-sound');
  const settings = audioManager.settings;
  const silent = !settings.enabled || settings.muted;
  button.querySelector('.icon-sound-on').toggleAttribute('hidden', silent);
  button.querySelector('.icon-sound-off').toggleAttribute('hidden', !silent);
  button.setAttribute('aria-label', silent ? t('a11y.unmute') : t('a11y.mute'));
  button.setAttribute('aria-pressed', String(silent));
}

function sound(key, options) {
  audioManager.playSound(key, options);
}

/* ---------------------------------------------------------- preferences */

function applyPreferences() {
  state.language = storage.getChoice('language', ['en', 'fr'], null) ?? detectLanguage();
  setI18nLanguage(state.language);
  document.documentElement.lang = state.language;

  const appearance = storage.getChoice('appearance', ['system', 'light', 'dark'], 'system');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const mode = appearance === 'system' ? (dark.matches ? 'dark' : 'light') : appearance;
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.theme = storage.getChoice('theme', ['classic', 'minimal', 'salon'], 'salon');

  // The enhanced motion director is solo-table specific; multiplayer uses
  // the classic card animations unless the player chose "off".
  const anim = storage.getChoice('animations', ['enhanced', 'classic', 'off'], null);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.anim = anim === 'off' || (anim === null && reduced)
    ? 'off'
    : 'classic';

  const meta = document.querySelector('meta[name="theme-color"]');
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  if (meta && surface) meta.setAttribute('content', surface);
}

/* -------------------------------------------------------------- screens */

const SCREENS = ['screen-menu', 'screen-host-setup', 'screen-join', 'screen-room'];

function showScreen(id) {
  for (const screen of SCREENS) $(screen).hidden = screen !== id;
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ static text */

function renderStaticLabels() {
  document.title = `Blackjack Lab — ${t('mp.menu.title')}`;
  $('fictional-badge').textContent = t('app.fictionalBadge');
  $('experimental-badge').textContent = t('mp.badgeExperimental');
  $('language-label').textContent = t('a11y.chooseLanguage');
  $('btn-solo-link').textContent = t('mp.menu.solo');
  $('fictional-note').textContent = t('app.fictionalNote');

  $('menu-title').textContent = t('mp.menu.title');
  $('menu-tagline').textContent = t('mp.menu.tagline');
  $('menu-solo-name').textContent = t('mp.menu.solo');
  $('menu-solo-desc').textContent = t('mp.menu.soloDesc');
  $('menu-host-name').textContent = t('mp.menu.host');
  $('menu-host-desc').textContent = t('mp.menu.hostDesc');
  $('menu-join-name').textContent = t('mp.menu.join');
  $('menu-join-desc').textContent = t('mp.menu.joinDesc');
  $('how-title').textContent = t('mp.how.title');
  $('how-body-1').textContent = t('mp.how.body1');
  $('how-body-2').textContent = t('mp.how.body2');
  $('how-body-3').textContent = t('mp.how.body3');
  $('how-body-4').textContent = t('mp.how.body4');
  $('webrtc-unsupported').textContent = t('mp.webrtcUnsupported');

  $('host-setup-title').textContent = t('mp.hostSetup.title');
  $('host-room-name-label').textContent = t('mp.hostSetup.roomName');
  $('host-name-label').textContent = t('mp.hostSetup.yourName');
  $('host-max-players-label').textContent = t('mp.hostSetup.maxPlayers');
  $('host-plays-label').textContent = t('mp.hostSetup.hostPlays');
  $('host-profile-label').textContent = t('mp.hostSetup.profile');
  $('host-bankroll-label').textContent = t('mp.hostSetup.startingBankroll');
  $('host-min-bet-label').textContent = t('mp.hostSetup.minBet');
  $('host-max-bet-label').textContent = t('mp.hostSetup.maxBet');
  $('host-setup-back').textContent = t('mp.back');
  $('host-setup-create').textContent = t('mp.hostSetup.create');

  $('join-title').textContent = t('mp.join.title');
  $('join-name-label').textContent = t('mp.join.nameLabel');
  $('join-step1-title').textContent = t('mp.join.step1Title');
  $('join-step1-body').textContent = t('mp.join.step1Body');
  $('join-offer-input').placeholder = t('mp.pasteCode');
  $('join-back').textContent = t('mp.back');
  $('join-scan').textContent = t('mp.scan');
  $('join-scan-stop').textContent = t('mp.scanStop');
  $('join-continue').textContent = t('mp.join.continue');
  $('join-step2-title').textContent = t('mp.join.step2Title');
  $('join-step2-body').textContent = t('mp.join.step2Body');
  $('join-answer-copy').textContent = t('mp.copy');
  $('join-answer-share').textContent = t('mp.share');
  $('join-waiting').textContent = '';

  $('mp-players-title').textContent = t('mp.room.players');
  $('btn-invite').textContent = t('mp.invite.open');
  $('mp-host-controls-title').textContent = t('mp.room.hostControls');
  $('btn-start-game').textContent = t('mp.room.startGame');
  $('btn-start-round').textContent = t('mp.room.startRound');
  $('btn-next-round').textContent = t('mp.room.nextRound');
  $('btn-end-room').textContent = t('mp.room.endRoom');
  $('btn-leave-room').textContent = t('mp.room.leaveRoom');
  $('mp-host-note').textContent = t('mp.room.hostNote');
  $('mp-history-title').textContent = t('history.title');
  $('mp-history-empty').textContent = t('history.empty');
  $('mp-dealer-label').textContent = t('hand.dealer');
  $('mp-bankroll-label').textContent = t('bet.bankroll');
  $('mp-bet-label').textContent = t('bet.currentBet');
  $('mp-btn-clear').textContent = t('bet.clear');
  $('mp-btn-bet').textContent = t('mp.table.placeBet');
  $('mp-btn-ready').textContent = t('mp.table.ready');

  $('invite-title').textContent = t('mp.invite.title');
  $('invite-close').textContent = t('settings.close');
  $('invite-step1-title').textContent = t('mp.invite.step1Title');
  $('invite-step1-body').textContent = t('mp.invite.step1Body');
  $('invite-step2-title').textContent = t('mp.invite.step2Title');
  $('invite-step2-body').textContent = t('mp.invite.step2Body');
  $('invite-copy').textContent = t('mp.copy');
  $('invite-share').textContent = t('mp.share');
  $('invite-scan').textContent = t('mp.scan');
  $('invite-scan-stop').textContent = t('mp.scanStop');
  $('invite-connect').textContent = t('mp.invite.connect');
  $('invite-answer-input').placeholder = t('mp.pasteCode');

  $('confirm-cancel').textContent = t('settings.bankrollCancel');

  for (const button of document.querySelectorAll('#mp-panel-actions [data-action]')) {
    const label = button.querySelector('.btn__label');
    (label ?? button).textContent = t(`actions.${button.dataset.action}`);
  }
  updateSoundButton();
  renderRoom();
}

/* ---------------------------------------------------------- error text */

function errorText(code) {
  const key = `mp.errors.${code}`;
  const text = t(key);
  return text === key ? t('mp.errors.generic') : text;
}

function signalErrorText(code) {
  const key = `mp.signalErrors.${code}`;
  const text = t(key);
  return text === key ? t('mp.errors.generic') : text;
}

/* -------------------------------------------------------------- helpers */

function myPlayerId() {
  if (state.role === 'host') return state.hostSession?.hostPlayerId ?? null;
  return state.clientSession?.playerId ?? null;
}

function sendCommand(type, payload) {
  try {
    if (state.role === 'host') {
      state.hostSession.localCommand(type, payload);
    } else if (state.clientSession) {
      switch (type) {
        case MESSAGE_TYPES.PLACE_BET: state.clientSession.placeBet(payload.betCents); break;
        case MESSAGE_TYPES.CLEAR_BET: state.clientSession.clearBet(); break;
        case MESSAGE_TYPES.PLAYER_READY: state.clientSession.setReady(payload.ready); break;
        case MESSAGE_TYPES.GAME_ACTION: state.clientSession.act(payload.action); break;
        case MESSAGE_TYPES.DECISION:
          state.clientSession.decide(payload.decision, payload.accept);
          break;
        default: break;
      }
    }
  } catch (error) {
    console.error(error);
    sound('uiInvalid');
    showToast(t('mp.errors.generic'));
  }
}

function currentPayload() {
  if (state.role === 'host') return state.hostSession?.buildSnapshot() ?? null;
  return state.clientSession?.snapshot ?? null;
}

/* ---------------------------------------------------------------- render */

function renderRoom() {
  const payload = currentPayload();
  if (!payload || $('screen-room').hidden) return;
  const localId = myPlayerId();

  $('room-title').textContent = payload.room.name;
  const badge = $('room-phase-badge');
  badge.textContent = payload.phase === ROOM_PHASES.LOBBY
    ? t('mp.room.lobbyBadge')
    : t('mp.room.tableBadge');

  const banner = $('room-banner');
  if (payload.paused) {
    banner.hidden = false;
    banner.textContent = t('mp.room.pausedBanner');
  } else if (state.role === 'host') {
    banner.hidden = false;
    banner.textContent = t('mp.room.hostKeepOpen');
  } else {
    banner.hidden = true;
  }

  renderPlayerList(payload.players, localId);

  const isHost = state.role === 'host';
  $('mp-host-controls').hidden = !isHost;
  $('mp-leave-card').hidden = isHost;
  $('btn-invite').hidden = !isHost
    || payload.players.length >= payload.room.maxPlayers;

  const table = payload.table;
  $('btn-start-game').hidden = !isHost || payload.phase !== ROOM_PHASES.LOBBY;
  $('btn-start-round').hidden = !isHost || !table || table.state !== TABLE_STATES.BETTING;
  $('btn-start-round').disabled = !isHost || !state.hostSession?.table?.canStartRound();
  $('btn-next-round').hidden = !isHost || !table || table.state !== TABLE_STATES.ROUND_COMPLETE;
  $('btn-pause').hidden = !isHost || payload.phase !== ROOM_PHASES.TABLE;
  $('btn-pause').textContent = payload.paused ? t('mp.room.resume') : t('mp.room.pause');
  $('btn-pause').setAttribute('aria-pressed', String(payload.paused));

  $('mp-table').hidden = !table;
  $('mp-controls').hidden = !table;
  if (!table) {
    $('mp-table-message').textContent = '';
    if (!isHost) announceOnce('lobby', t('mp.room.waitingForHost'));
    return;
  }

  renderMpTable(table, {
    localPlayerId: localId,
    seenCardIds: state.seenCardIds,
    prevHoleHidden: state.prevHoleHidden,
  });
  renderMpHistory(payload.history ?? [], localId);
  renderTableMessage(table, localId);
  renderPanels(table, localId);
  playSnapshotAudio(payload, table, localId);
  state.lastPayload = payload;
}

function renderTableMessage(table, localId) {
  const el = $('mp-table-message');
  if (table.state === TABLE_STATES.BETTING) {
    el.textContent = t('bet.placeYourBet');
  } else if (table.state === TABLE_STATES.PLAYER_TURN) {
    const seat = table.seats.find((s) => s.playerId === table.activePlayerId);
    el.textContent = table.activePlayerId === localId
      ? t('round.yourTurn')
      : t('mp.table.turnOf', { name: seat?.name ?? '' });
  } else if (table.state === TABLE_STATES.PRE_PLAY) {
    el.textContent = t('mp.table.decisions');
  } else if (table.state === TABLE_STATES.ROUND_COMPLETE) {
    el.textContent = t('mp.table.roundComplete');
  } else {
    el.textContent = '';
  }
}

function renderPanels(table, localId) {
  const seat = table.seats.find((s) => s.playerId === localId) ?? null;
  const isBetting = table.state === TABLE_STATES.BETTING && seat;
  const isDeciding = seat?.pendingDecision;
  const myTurn = table.state === TABLE_STATES.PLAYER_TURN
    && table.activePlayerId === localId;

  $('mp-panel-bet').hidden = !isBetting;
  $('mp-panel-decision').hidden = !isDeciding;
  $('mp-panel-actions').hidden = !myTurn;
  $('mp-panel-wait').hidden = Boolean(isBetting || isDeciding || myTurn);

  $('mp-bankroll-value').textContent = seat ? formatMoney(seat.bankrollCents) : '—';
  const committed = seat
    ? seat.hands.reduce((sum, h) => sum + h.betCents, 0)
      + (seat.insurance?.taken ? seat.insurance.betCents : 0)
    : 0;
  $('mp-bet-value').textContent = formatMoney(
    table.state === TABLE_STATES.BETTING ? (seat?.betCents || state.betCents) : committed,
  );
  $('mp-shoe-count').textContent = t('round.cardsLeft', { count: table.shoe.remaining });

  if (isBetting) renderBetPanel(table, seat);
  if (isDeciding) renderDecisionPanel(seat);
  if (myTurn) renderActionPanel(table, seat);
  if (!isBetting && !isDeciding && !myTurn) renderWaitPanel(table, seat, localId);
}

function renderBetPanel(table, seat) {
  const chipRow = $('mp-chip-row');
  chipRow.textContent = '';
  chipRow.setAttribute('aria-label', t('a11y.betControls'));
  const budget = Math.min(seat.bankrollCents + seat.betCents, table.maxBetCents);
  for (const value of CHIP_VALUES) {
    if (unitsToCents(value) > table.maxBetCents) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = String(value);
    chip.textContent = String(value);
    chip.setAttribute('aria-label', t('bet.addChip', { value }));
    if (state.betCents + unitsToCents(value) > budget) chip.disabled = true;
    chipRow.append(chip);
  }
  const committedText = seat.betCents > 0
    ? ` ${t('mp.table.betPlaced', { amount: formatMoney(seat.betCents) })}`
    : '';
  $('mp-bet-prompt').textContent = t('bet.placeYourBet') + committedText;
  $('mp-btn-bet').disabled = state.betCents < table.minBetCents || state.betCents > budget;
  $('mp-btn-clear').disabled = state.betCents === 0 && seat.betCents === 0;
  $('mp-btn-ready').disabled = seat.betCents === 0;
  $('mp-btn-ready').setAttribute('aria-pressed', String(seat.ready));
  $('mp-btn-ready').classList.toggle('btn--primary', !seat.ready);
  $('mp-table-range').textContent = t('bet.tableRange', {
    min: formatMoney(table.minBetCents),
    max: formatMoney(table.maxBetCents),
  });
}

function renderDecisionPanel(seat) {
  const half = formatMoney(seat.hands[0].betCents / 2);
  if (seat.pendingDecision === SEAT_DECISIONS.INSURANCE) {
    $('mp-decision-question').textContent = t('insurance.question', { cost: half });
    $('mp-btn-decision-yes').textContent = t('insurance.yes');
    $('mp-btn-decision-no').textContent = t('insurance.no');
  } else {
    $('mp-decision-question').textContent = t('earlySurrender.question', { half });
    $('mp-btn-decision-yes').textContent = t('earlySurrender.yes');
    $('mp-btn-decision-no').textContent = t('earlySurrender.no');
  }
}

function renderActionPanel(table, seat) {
  const availability = seat.actionAvailability;
  const surrenderSupported = table.profileSurrender !== SURRENDER_MODES.NONE;
  for (const button of document.querySelectorAll('#mp-panel-actions [data-action]')) {
    const action = button.dataset.action;
    if (action === ACTIONS.SURRENDER && !surrenderSupported) {
      button.hidden = true;
      continue;
    }
    button.hidden = false;
    const { legal, reason } = availability[action];
    if (legal) {
      button.removeAttribute('aria-disabled');
      button.classList.remove('is-disabled');
      button.removeAttribute('title');
      button.removeAttribute('aria-description');
    } else {
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('is-disabled');
      const reasonText = t(`reasons.${reason}`);
      button.title = reasonText;
      button.setAttribute('aria-description', reasonText);
    }
  }
}

function renderWaitPanel(table, seat, localId) {
  let message = '';
  if (!seat) {
    message = t('mp.table.spectating');
  } else if (table.state === TABLE_STATES.PLAYER_TURN) {
    const active = table.seats.find((s) => s.playerId === table.activePlayerId);
    message = t('mp.table.turnOf', { name: active?.name ?? '' });
  } else if (table.state === TABLE_STATES.PRE_PLAY) {
    message = t('mp.table.waitingDecisions');
  } else if (table.state === TABLE_STATES.ROUND_COMPLETE) {
    const net = seat.roundNetCents;
    if (net === null || net === undefined) message = t('mp.table.roundComplete');
    else if (net > 0) message = t('results.netWin', { amount: formatMoney(net) });
    else if (net < 0) message = t('results.netLoss', { amount: `-${formatMoney(-net)}` });
    else message = t('results.netEven');
    if (seat.sittingOut) message = t('mp.table.sittingOut');
  } else if (table.state === TABLE_STATES.BETTING) {
    message = t('mp.table.waitingOthers');
  }
  $('mp-wait-message').textContent = message;
}

/* ----------------------------------------------------- audio + announce */

const announced = new Map();

function announceOnce(key, message) {
  if (announced.get(key) === message) return;
  announced.set(key, message);
  announce(message);
}

function playSnapshotAudio(payload, table, localId) {
  // New cards, regardless of whose they are.
  let delay = 0;
  const collect = (cards) => {
    for (const card of cards) {
      if (!card.hidden && card.id && !state.audioSeenCards.has(card.id)) {
        state.audioSeenCards.add(card.id);
        sound('cardDeal', { delay });
        delay += 0.12;
      }
    }
  };
  for (const seat of table.seats) for (const hand of seat.hands) collect(hand.cards);
  collect(table.dealer.cards);

  // Turn announcements: sound + live region when it becomes my turn.
  const turnKey = `${table.roundCounter}:${table.activePlayerId}:${table.activeHandIndex}`;
  if (table.state === TABLE_STATES.PLAYER_TURN && state.lastAnnouncedTurn !== turnKey) {
    state.lastAnnouncedTurn = turnKey;
    const active = table.seats.find((s) => s.playerId === table.activePlayerId);
    if (table.activePlayerId === localId) {
      sound('knock', { delay });
      announce(t('round.yourTurn'));
    } else if (active) {
      announce(t('mp.table.turnOf', { name: active.name }));
    }
  }

  // One result sound per completed round, from my seat's point of view.
  if (table.state === TABLE_STATES.ROUND_COMPLETE
    && table.roundCounter > state.lastResultRound) {
    state.lastResultRound = table.roundCounter;
    const mine = payload.history?.length
      ? payload.history[payload.history.length - 1].summaries?.[localId]
      : null;
    if (mine) {
      const key = mine.netCents > 0 ? 'resultWin' : (mine.netCents < 0 ? 'resultLoss' : 'resultPush');
      sound(mine.results.includes('BLACKJACK_WIN') ? 'resultBlackjack' : key,
        { delay: delay + 0.35 });
      const text = mine.netCents > 0
        ? t('results.netWin', { amount: formatMoney(mine.netCents) })
        : mine.netCents < 0
          ? t('results.netLoss', { amount: `-${formatMoney(-mine.netCents)}` })
          : t('results.netEven');
      announce(text);
    }
  }
}

/* ------------------------------------------------------------ host flow */

function populateProfileSelect() {
  const select = $('host-profile');
  select.textContent = '';
  for (const id of PROFILE_IDS) {
    if (id === 'CUSTOM' && !storage.getObject('customProfile')) continue;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = t(`profiles.${id}.name`);
    select.append(option);
  }
}

function readPositiveInt(input) {
  const value = Number(input.value.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function createHostRoom(event) {
  event.preventDefault();
  const errorEl = $('host-setup-error');
  errorEl.hidden = true;
  const bankroll = readPositiveInt($('host-bankroll'));
  const minBet = readPositiveInt($('host-min-bet'));
  const maxBet = readPositiveInt($('host-max-bet'));
  const hostName = $('host-name').value.trim() || t('mp.status.host');
  if (!bankroll || !minBet || !maxBet || minBet > maxBet || maxBet > bankroll) {
    errorEl.textContent = t('mp.hostSetup.invalid');
    errorEl.hidden = false;
    return;
  }
  let profile;
  try {
    profile = getProfile($('host-profile').value, storage.getObject('customProfile'));
  } catch {
    errorEl.textContent = t('mp.hostSetup.invalid');
    errorEl.hidden = false;
    return;
  }
  storage.setChoice(NAME_KEY, hostName);
  startHostSession({
    config: {
      roomName: $('host-room-name').value.trim() || t('mp.menu.title'),
      maxPlayers: Number($('host-max-players').value),
      hostPlays: $('host-plays').checked,
      hostName,
      profile,
      startingBankrollUnits: bankroll,
      minBetUnits: minBet,
      maxBetUnits: maxBet,
    },
  });
}

function startHostSession({ config, restore = null }) {
  const session = new HostSession({ config, storage, restore });
  state.hostSession = session;
  state.role = 'host';
  resetRenderMemory();
  session.events.on('change', renderRoom);
  session.events.on('playerJoined', ({ name }) => {
    sound('uiOpen');
    showToast(t('mp.invite.connected', { name }));
    closeInviteDialog();
  });
  session.events.on('playerReconnected', () => {
    sound('uiOpen');
    closeInviteDialog();
  });
  session.events.on('ended', () => {
    showScreen('screen-menu');
    refreshRestoreCard();
  });
  showScreen('screen-room');
  renderRoom();
}

function refreshRestoreCard() {
  const record = HostSession.readPersisted(storage);
  const card = $('menu-restore');
  if (!record) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $('menu-restore-name').textContent = t('mp.menu.restore', { name: record.roomName });
  $('menu-restore-desc').textContent = t('mp.menu.restoreDesc', {
    count: record.players.length,
  });
  card.onclick = () => {
    let profile;
    try {
      profile = getProfile(record.profileId, storage.getObject('customProfile'));
    } catch {
      showToast(t('errors.corruptSave'));
      HostSession.clearPersisted(storage);
      card.hidden = true;
      return;
    }
    startHostSession({
      config: {
        roomName: record.roomName,
        maxPlayers: record.maxPlayers,
        hostPlays: record.hostPlays,
        hostName: record.hostName,
        profile,
        startingBankrollUnits: record.startingBankrollUnits,
        minBetUnits: record.minBetUnits,
        maxBetUnits: record.maxBetUnits,
      },
      restore: record,
    });
    if (record.roundCounter > 0 || record.players.length > 0) {
      // Players re-pair into their reserved seats; the game resumes from
      // the betting phase once the host restarts it.
      showToast(t('mp.room.restoredNote'));
    }
  };
}

/* -------------------------------------------------------- invite wizard */

async function openInviteDialog() {
  const dialog = $('dialog-invite');
  $('invite-error').hidden = true;
  $('invite-offer-qr').textContent = '';
  $('invite-offer-output').value = '';
  $('invite-answer-input').value = '';
  $('invite-generating').textContent = t('mp.invite.generating');
  dialog.showModal();
  sound('uiOpen');
  try {
    const { link, description } = await createHostLink({
      onClose: () => {},
    });
    state.inviteLink = link;
    state.invitePeerId = link.transport.id;
    const code = await encodeSignal({
      kind: SIGNAL_KINDS.OFFER,
      sessionId: state.hostSession.sessionId,
      peerId: state.invitePeerId,
      description,
    });
    if (!dialog.open) {
      link.close();
      return;
    }
    $('invite-generating').textContent = '';
    $('invite-offer-output').value = code;
    renderQrInto($('invite-offer-qr'), code);
    $('invite-share').hidden = !navigator.share;
  } catch (error) {
    console.error(error);
    $('invite-generating').textContent = '';
    showInviteError(t('mp.errors.generic'));
  }
}

function renderQrInto(container, code) {
  try {
    container.innerHTML = qrSvg(code, { ecLevel: 'L', margin: 3 });
    container.setAttribute('aria-label', t('mp.qrLabel'));
  } catch (error) {
    // Payload too large for a QR code: copy/paste still works.
    console.error(error);
    container.textContent = '';
  }
}

function showInviteError(text) {
  const el = $('invite-error');
  el.textContent = text;
  el.hidden = false;
  sound('uiInvalid');
}

async function connectInviteAnswer() {
  $('invite-error').hidden = true;
  const raw = $('invite-answer-input').value.trim();
  if (!raw || !state.inviteLink) return;
  const decoded = await decodeSignal(raw, { expectKind: SIGNAL_KINDS.ANSWER });
  if (!decoded.ok) {
    showInviteError(signalErrorText(decoded.code));
    return;
  }
  if (decoded.signal.sessionId !== state.hostSession.sessionId
    || decoded.signal.peerId !== state.invitePeerId) {
    showInviteError(signalErrorText('WRONG_ROOM'));
    return;
  }
  try {
    // The link belongs to the session from here on: the dialog-close
    // handler must not tear it down once the answer is applied.
    const link = state.inviteLink;
    state.inviteLink = null;
    state.hostSession.attachTransport(link.transport);
    await acceptAnswer(link, decoded.signal.description);
    $('invite-connect').disabled = true;
    setTimeout(() => { $('invite-connect').disabled = false; }, 500);
  } catch (error) {
    console.error(error);
    showInviteError(t('mp.errors.connectFailed'));
  }
}

function closeInviteDialog() {
  const dialog = $('dialog-invite');
  if (dialog.open) dialog.close();
  stopScanner();
  if (state.inviteLink) {
    state.inviteLink.close();
    state.inviteLink = null;
  }
}

/* ------------------------------------------------------------ join flow */

function resumeRecordFor(sessionId) {
  return storage.getObject(RESUME_PREFIX + sessionId);
}

async function continueJoin() {
  const errorEl = $('join-error');
  errorEl.hidden = true;
  const name = $('join-name').value.trim();
  if (!name) {
    errorEl.textContent = errorText('BAD_NAME');
    errorEl.hidden = false;
    return;
  }
  const raw = $('join-offer-input').value.trim();
  const decoded = await decodeSignal(raw, { expectKind: SIGNAL_KINDS.OFFER });
  if (!decoded.ok) {
    errorEl.textContent = signalErrorText(decoded.code);
    errorEl.hidden = false;
    return;
  }
  storage.setChoice(NAME_KEY, name);
  stopScanner();
  try {
    const { link, description } = await createClientLink(decoded.signal.description, {
      onOpen: () => onClientChannelOpen(),
    });
    state.clientLink = link;
    const resume = resumeRecordFor(decoded.signal.sessionId);
    state.clientSession = new ClientSession({
      transport: link.transport,
      name,
      resume: resume ? { playerId: resume.playerId, token: resume.token } : null,
    });
    wireClientSession(state.clientSession);
    const answerCode = await encodeSignal({
      kind: SIGNAL_KINDS.ANSWER,
      sessionId: decoded.signal.sessionId,
      peerId: decoded.signal.peerId,
      description,
      name,
    });
    $('join-step-name').hidden = true;
    $('join-step-answer').hidden = false;
    $('join-answer-output').value = answerCode;
    renderQrInto($('join-answer-qr'), answerCode);
    $('join-answer-share').hidden = !navigator.share;
    $('join-waiting').textContent = t('mp.join.waitingHost');
  } catch (error) {
    console.error(error);
    errorEl.textContent = t('mp.errors.connectFailed');
    errorEl.hidden = false;
  }
}

function onClientChannelOpen() {
  state.clientSession?.join();
}

function wireClientSession(client) {
  state.role = 'client';
  resetRenderMemory();
  client.on('accepted', (payload) => {
    storage.setObject(RESUME_PREFIX + payload.sessionId, {
      playerId: payload.playerId,
      token: payload.reconnectToken,
      name: client.name,
      savedAt: Date.now(),
    });
    sound('uiOpen');
    showScreen('screen-room');
    renderRoom();
  });
  client.on('rejected', (payload) => {
    showToast(errorText(payload.code));
    sound('uiInvalid');
    resetToJoinScreen();
  });
  client.on('state', () => renderRoom());
  client.on('error', (payload) => {
    sound('uiInvalid');
    showToast(errorText(payload.code));
  });
  client.on('ended', () => {
    sound('uiClose');
    showToast(t('mp.room.sessionEnded'));
    leaveToMenu();
  });
  client.on('closed', () => {
    sound('uiInvalid');
    showToast(t('mp.errors.connectionLost'));
    resetToJoinScreen({ keepOffer: false });
  });
}

function resetToJoinScreen({ keepOffer = false } = {}) {
  state.clientSession = null;
  if (state.clientLink) {
    state.clientLink.close();
    state.clientLink = null;
  }
  $('join-step-name').hidden = false;
  $('join-step-answer').hidden = true;
  if (!keepOffer) $('join-offer-input').value = '';
  $('join-waiting').textContent = '';
  showScreen('screen-join');
  const hint = $('join-resume-note');
  hint.textContent = t('mp.errors.connectionLostHint');
  hint.hidden = false;
}

/* --------------------------------------------------------------- scanner */

async function beginScan(videoId, scannerId, onCode) {
  stopScanner();
  if (!await qrScanningSupported()) {
    showToast(t('mp.scanUnsupported'));
    return;
  }
  const container = $(scannerId);
  container.hidden = false;
  try {
    state.scanner = await startQrScanner($(videoId), (text) => {
      if (!text.startsWith('BJL')) return;
      onCode(text);
      stopScanner();
    });
  } catch (error) {
    console.error(error);
    container.hidden = true;
    showToast(t('mp.cameraDenied'));
  }
}

function stopScanner() {
  state.scanner?.stop();
  state.scanner = null;
  $('join-scanner').hidden = true;
  $('invite-scanner').hidden = true;
}

/* ------------------------------------------------------------ navigation */

function leaveToMenu() {
  stopScanner();
  closeInviteDialog();
  if (state.clientSession && !state.clientSession.ended) state.clientSession.leave();
  state.clientSession = null;
  if (state.clientLink) {
    state.clientLink.close();
    state.clientLink = null;
  }
  state.role = null;
  state.hostSession = null;
  refreshRestoreCard();
  showScreen('screen-menu');
}

function resetRenderMemory() {
  state.seenCardIds.clear();
  state.audioSeenCards.clear();
  state.prevHoleHidden.value = false;
  state.betCents = 0;
  state.lastAnnouncedTurn = null;
  state.lastResultRound = 0;
}

function confirmDialog({ title, body, confirmLabel, onConfirm }) {
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('confirm-accept').textContent = confirmLabel;
  const dialog = $('dialog-confirm');
  dialog.showModal();
  $('confirm-accept').onclick = () => {
    dialog.close();
    onConfirm();
  };
  $('confirm-cancel').onclick = () => dialog.close();
}

/* ---------------------------------------------------------------- events */

function wireEvents() {
  const unlock = () => audioManager.unlock();
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  audioManager.bindVisibility(document);
  $('btn-sound').addEventListener('click', () => {
    audioManager.toggleMuted();
    updateSoundButton();
  });

  initLanguageMenu({
    onSelect: (language) => {
      state.language = language;
      setI18nLanguage(language);
      storage.setChoice('language', language);
      document.documentElement.lang = language;
      setLanguageMenuValue(language);
      renderStaticLabels();
      populateProfileSelect();
    },
  });

  // Menu
  $('menu-host').addEventListener('click', () => {
    $('host-name').value = readStoredName();
    showScreen('screen-host-setup');
  });
  $('menu-join').addEventListener('click', () => {
    $('join-name').value = readStoredName();
    showScreen('screen-join');
  });

  // Host setup
  $('host-setup-form').addEventListener('submit', createHostRoom);
  $('host-setup-back').addEventListener('click', () => showScreen('screen-menu'));

  // Invite wizard
  $('btn-invite').addEventListener('click', openInviteDialog);
  $('invite-close').addEventListener('click', closeInviteDialog);
  $('invite-copy').addEventListener('click', () => copyText($('invite-offer-output').value));
  $('invite-share').addEventListener('click', () => shareText($('invite-offer-output').value));
  $('invite-connect').addEventListener('click', connectInviteAnswer);
  $('invite-scan').addEventListener('click', () => beginScan('invite-video', 'invite-scanner', (text) => {
    $('invite-answer-input').value = text;
    connectInviteAnswer();
  }));
  $('invite-scan-stop').addEventListener('click', stopScanner);

  // Join wizard
  $('join-back').addEventListener('click', () => {
    stopScanner();
    leaveToMenu();
  });
  $('join-continue').addEventListener('click', continueJoin);
  $('join-scan').addEventListener('click', () => beginScan('join-video', 'join-scanner', (text) => {
    $('join-offer-input').value = text;
  }));
  $('join-scan-stop').addEventListener('click', stopScanner);
  $('join-answer-copy').addEventListener('click', () => copyText($('join-answer-output').value));
  $('join-answer-share').addEventListener('click', () => shareText($('join-answer-output').value));

  // Room: host controls
  $('btn-start-game').addEventListener('click', () => {
    try {
      state.hostSession.startGame();
      sound('chipStack');
    } catch (error) {
      console.error(error);
      showToast(t('mp.errors.generic'));
    }
  });
  $('btn-start-round').addEventListener('click', () => {
    try {
      state.betCents = 0;
      state.hostSession.startRound();
      sound('cardDeal');
    } catch (error) {
      console.error(error);
      showToast(t('mp.errors.generic'));
    }
  });
  $('btn-next-round').addEventListener('click', () => {
    try {
      state.betCents = 0;
      state.hostSession.nextRound();
      sound('cardShove');
    } catch (error) {
      console.error(error);
      showToast(t('mp.errors.generic'));
    }
  });
  $('btn-pause').addEventListener('click', () => {
    state.hostSession.setPaused(!state.hostSession.paused);
    sound('uiToggle');
  });
  $('btn-end-room').addEventListener('click', () => confirmDialog({
    title: t('mp.confirm.endTitle'),
    body: t('mp.confirm.endBody'),
    confirmLabel: t('mp.room.endRoom'),
    onConfirm: () => {
      state.hostSession.endSession('HOST_ENDED');
      sound('uiClose');
      leaveToMenu();
    },
  }));
  $('btn-leave-room').addEventListener('click', () => confirmDialog({
    title: t('mp.confirm.leaveTitle'),
    body: t('mp.confirm.leaveBody'),
    confirmLabel: t('mp.room.leaveRoom'),
    onConfirm: () => {
      sound('uiClose');
      leaveToMenu();
    },
  }));

  // Betting
  $('mp-chip-row').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip || chip.disabled) return;
    state.betCents += unitsToCents(Number(chip.dataset.value));
    sound('chipAdd');
    renderRoom();
  });
  $('mp-btn-clear').addEventListener('click', () => {
    state.betCents = 0;
    sound('chipCollide');
    sendCommand(MESSAGE_TYPES.CLEAR_BET, {});
    renderRoom();
  });
  $('mp-btn-bet').addEventListener('click', () => {
    if (state.betCents <= 0) return;
    sound('chipStack');
    sendCommand(MESSAGE_TYPES.PLACE_BET, { betCents: state.betCents });
    renderRoom();
  });
  $('mp-btn-ready').addEventListener('click', () => {
    const seat = currentPayload()?.table?.seats.find((s) => s.playerId === myPlayerId());
    sound('uiToggle');
    sendCommand(MESSAGE_TYPES.PLAYER_READY, { ready: !seat?.ready });
  });

  // Actions
  for (const button of document.querySelectorAll('#mp-panel-actions [data-action]')) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') {
        sound('uiInvalid');
        return;
      }
      const action = button.dataset.action;
      if (action === ACTIONS.STAND) sound('knock');
      if (action === ACTIONS.DOUBLE) sound('chipStack');
      if (action === ACTIONS.SPLIT) sound('chipCollide');
      if (action === ACTIONS.SURRENDER) sound('cardShove');
      sendCommand(MESSAGE_TYPES.GAME_ACTION, { action });
    });
  }

  // Decisions
  $('mp-btn-decision-yes').addEventListener('click', () => sendDecision(true));
  $('mp-btn-decision-no').addEventListener('click', () => sendDecision(false));

  // The host page owns every connection: closing it drops all players.
  window.addEventListener('beforeunload', (event) => {
    if (state.role === 'host' && state.hostSession
      && state.hostSession.players.size > (state.hostSession.hostPlayerId ? 1 : 0)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

function sendDecision(accept) {
  const seat = currentPayload()?.table?.seats.find((s) => s.playerId === myPlayerId());
  if (!seat?.pendingDecision) return;
  sound(accept ? 'chipAdd' : 'uiClick');
  sendCommand(MESSAGE_TYPES.DECISION, {
    decision: seat.pendingDecision === SEAT_DECISIONS.INSURANCE
      ? SEAT_DECISIONS.INSURANCE
      : SEAT_DECISIONS.EARLY_SURRENDER,
    accept,
  });
}

function readStoredName() {
  try {
    return globalThis.localStorage?.getItem('bjlab.mp.playerName') ?? '';
  } catch {
    return '';
  }
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(t('mp.copied'));
    sound('uiClick');
  } catch {
    showToast(t('mp.copyFailed'));
  }
}

async function shareText(text) {
  if (!text || !navigator.share) return;
  try {
    await navigator.share({ text });
  } catch { /* user dismissed the share sheet */ }
}

/* ------------------------------------------------------------------ boot */

function boot() {
  applyPreferences();
  wireEvents();
  setLanguageMenuValue(state.language);
  populateProfileSelect();
  renderStaticLabels();
  refreshRestoreCard();
  if (!isWebRtcSupported()) {
    $('webrtc-unsupported').hidden = false;
    $('menu-host').disabled = true;
    $('menu-join').disabled = true;
  }
  const hash = window.location.hash;
  if (hash === '#host' && isWebRtcSupported()) {
    $('host-name').value = readStoredName();
    showScreen('screen-host-setup');
  } else if (hash === '#join' && isWebRtcSupported()) {
    $('join-name').value = readStoredName();
    showScreen('screen-join');
  } else {
    showScreen('screen-menu');
  }
}

boot();
