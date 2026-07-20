import { t } from '../i18n/index.js';
import { formatMoney, formatRatio } from './format.js';
import { profileSummaryChips } from './profileSummary.js';
import { PROFILE_IDS, PROFILES } from '../config/profiles.js';
import { DEAL_MODES } from '../game/constants.js';
import { CENTS_PER_UNIT } from '../game/money.js';
import { buildMenuSelect } from './menuSelect.js';
import {
  MAX_BANKROLL_CENTS, MIN_BANKROLL_CENTS, parseStartingBankroll,
} from './bankrollSettings.js';

/**
 * Settings and help dialogs. Receives a controller object from app.js and
 * never talks to the engine directly.
 */

const $ = (id) => document.getElementById(id);

let controller = null;
let customDraft = null;

const APPEARANCES = ['system', 'light', 'dark'];
const THEMES = ['classic', 'minimal', 'salon'];
const THEME_LABEL_KEYS = {
  classic: 'settings.themeClassic',
  minimal: 'settings.themeMinimal',
  salon: 'settings.themeSalon',
};
const LANGUAGE_LABELS = { en: 'English', fr: 'Français' };

/** @param {object} appController */
export function initSettingsView(appController) {
  controller = appController;

  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    // One close sound per dialog, whatever closed it (button, Esc, backdrop).
    dialog.addEventListener('close', () => controller.audio.dialogClosed());
  }
  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('btn-settings').addEventListener('click', () => openSettings());
  $('btn-profile').addEventListener('click', () => openSettings());
  $('btn-help').addEventListener('click', () => {
    renderHelp();
    controller.audio.dialogOpened();
    $('dialog-help').showModal();
  });
  $('btn-set-bankroll').addEventListener('click', () => {
    if (controller.isRoundActive()) return;
    openBankrollDialog();
  });
  $('btn-bankroll-cancel').addEventListener('click', () => $('dialog-bankroll').close());
  $('bankroll-amount').addEventListener('input', clearBankrollError);
  $('bankroll-form').addEventListener('submit', submitBankroll);
}

function openSettings() {
  renderSettings();
  controller.audio.dialogOpened();
  $('dialog-settings').showModal();
}

/** Re-render the whole settings dialog from current state. */
export function renderSettings() {
  const state = controller.getState();

  $('settings-title').textContent = t('settings.title');
  $('set-language-label').textContent = t('settings.language');
  $('set-appearance-label').textContent = t('settings.appearance');
  $('set-theme-label').textContent = t('settings.theme');
  $('set-profile-label').textContent = t('settings.profile');
  $('profile-note').textContent = t('profiles.presetNote');
  $('profile-change-note').textContent = t('settings.profileChangeNote');
  renderBankrollButton();

  buildSegment($('settings-language'), ['en', 'fr'], state.language,
    (value) => LANGUAGE_LABELS[value],
    (value) => controller.setLanguage(value));

  buildSegment($('settings-appearance'), APPEARANCES, state.appearance,
    (value) => t(`settings.appearance${value[0].toUpperCase()}${value.slice(1)}`),
    (value) => controller.setAppearance(value));

  buildSegment($('settings-theme'), THEMES, state.theme,
    (value) => t(THEME_LABEL_KEYS[value]),
    (value) => controller.setTheme(value));

  renderAudioSection();
  buildProfileList(state);
  buildCustomEditor(state);
}

function buildSegment(container, values, current, labelOf, onSelect) {
  container.textContent = '';
  for (const value of values) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'segment__option';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(value === current));
    option.textContent = labelOf(value);
    option.addEventListener('click', () => {
      if (value !== current) controller.audio.settingChanged();
      onSelect(value);
      renderSettings();
    });
    container.append(option);
  }
}

/* ------------------------------------------------------------- audio UI */

function renderAudioSection() {
  const container = $('audio-controls');
  container.textContent = '';
  $('set-audio-label').textContent = t('settings.audio');

  if (!controller.audioSupported()) {
    const note = document.createElement('p');
    note.className = 'fine-print';
    note.textContent = t('settings.audioUnsupported');
    container.append(note);
    return;
  }

  const s = controller.getAudioSettings();

  const patch = (change) => {
    controller.setAudioSettings(change);
    controller.audio.settingChanged();
    renderAudioSection();
  };

  container.append(
    switchRow('audio-enabled', t('settings.audioEnable'), s.enabled, false,
      (value) => patch({ enabled: value })),
    switchRow('audio-muted', t('settings.audioMute'), s.muted, !s.enabled,
      (value) => patch({ muted: value })),
    sliderRow('audio-master', t('settings.audioMaster'), s.masterVolume, !s.enabled,
      (value) => controller.setAudioSettings({ masterVolume: value })),
    switchRow('audio-music', t('settings.audioMusic'), s.musicEnabled, !s.enabled,
      (value) => patch({ musicEnabled: value })),
    sliderRow('audio-music-volume', t('settings.audioMusicVolume'), s.musicVolume,
      !s.enabled || !s.musicEnabled,
      (value) => controller.setAudioSettings({ musicVolume: value })),
    switchRow('audio-ambience', t('settings.audioAmbience'), s.ambienceEnabled, !s.enabled,
      (value) => patch({ ambienceEnabled: value })),
    sliderRow('audio-ambience-volume', t('settings.audioAmbienceVolume'), s.ambienceVolume,
      !s.enabled || !s.ambienceEnabled,
      (value) => controller.setAudioSettings({ ambienceVolume: value })),
    switchRow('audio-effects', t('settings.audioEffects'), s.effectsEnabled, !s.enabled,
      (value) => patch({ effectsEnabled: value })),
    sliderRow('audio-effects-volume', t('settings.audioEffectsVolume'), s.effectsVolume,
      !s.enabled || !s.effectsEnabled,
      (value) => controller.setAudioSettings({ effectsVolume: value })),
    switchRow('audio-ui', t('settings.audioUi'), s.uiSoundsEnabled,
      !s.enabled || !s.effectsEnabled,
      (value) => patch({ uiSoundsEnabled: value })),
    switchRow('audio-variation', t('settings.audioVariation'), s.variationEnabled,
      !s.enabled || !s.effectsEnabled,
      (value) => patch({ variationEnabled: value })),
  );

  const actions = document.createElement('div');
  actions.className = 'audio-actions';
  const testButton = document.createElement('button');
  testButton.type = 'button';
  testButton.className = 'btn';
  testButton.textContent = t('settings.audioTest');
  testButton.disabled = !s.enabled;
  testButton.addEventListener('click', () => controller.playTestSound());
  const defaultsButton = document.createElement('button');
  defaultsButton.type = 'button';
  defaultsButton.className = 'btn';
  defaultsButton.textContent = t('settings.audioDefaults');
  defaultsButton.addEventListener('click', () => {
    controller.restoreAudioDefaults();
    controller.audio.settingChanged();
    renderAudioSection();
  });
  actions.append(testButton, defaultsButton);
  container.append(actions);
}

function switchRow(id, label, checked, disabled, onChange) {
  const row = document.createElement('div');
  row.className = 'audio-row';
  const labelEl = document.createElement('label');
  labelEl.id = `${id}-label`;
  labelEl.className = 'audio-row__label';
  labelEl.textContent = label;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = id;
  toggle.className = 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(checked));
  toggle.setAttribute('aria-labelledby', `${id}-label`);
  toggle.disabled = disabled;
  const knob = document.createElement('span');
  knob.className = 'switch__knob';
  toggle.append(knob);
  toggle.addEventListener('click', () => onChange(!checked));
  labelEl.addEventListener('click', () => {
    if (!toggle.disabled) toggle.click();
  });
  row.append(labelEl, toggle);
  return row;
}

function sliderRow(id, label, value, disabled, onInput) {
  const row = document.createElement('div');
  row.className = 'audio-row audio-row--slider';
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.className = 'audio-row__label';
  labelEl.textContent = label;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = id;
  slider.min = '0';
  slider.max = '100';
  slider.step = '5';
  slider.value = String(Math.round(value * 100));
  slider.disabled = disabled;
  const output = document.createElement('output');
  output.className = 'audio-row__value';
  output.setAttribute('for', id);
  output.textContent = `${Math.round(value * 100)}%`;
  // "input" adjusts the live gain smoothly on every tick without
  // re-rendering (a re-render would interrupt the drag).
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    output.textContent = `${v}%`;
    onInput(v / 100);
  });
  // "change" (drag released) gives one audible confirmation tick.
  slider.addEventListener('change', () => controller.audio.settingChanged());
  row.append(labelEl, slider, output);
  return row;
}

function buildProfileList(state) {
  const container = $('profile-list');
  container.textContent = '';
  const locked = controller.isRoundActive();
  for (const id of PROFILE_IDS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'profile-option';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(id === state.profileId));
    option.disabled = locked && id !== state.profileId;

    const name = document.createElement('span');
    name.className = 'profile-option__name';
    name.textContent = t(`profiles.${id}.name`);
    const desc = document.createElement('span');
    desc.className = 'profile-option__desc';
    desc.textContent = t(`profiles.${id}.description`);
    option.append(name, desc);

    const profile = id === 'CUSTOM' ? state.customProfile : PROFILES[id];
    if (profile) {
      const chips = document.createElement('span');
      chips.className = 'profile-option__chips';
      for (const chipText of profileSummaryChips(profile)) {
        const chip = document.createElement('span');
        chip.className = 'profile-option__chip';
        chip.textContent = chipText;
        chips.append(chip);
      }
      option.append(chips);
    }

    option.addEventListener('click', () => {
      if (option.disabled) return;
      if (id !== state.profileId) controller.audio.settingChanged();
      controller.setProfile(id);
      renderSettings();
    });
    container.append(option);
  }
}

/* ------------------------------------------------------- custom editor */

const BOOL_OPTIONS = [
  { value: 'true', key: 'settings.yes' },
  { value: 'false', key: 'settings.no' },
];

function editorFields(draft) {
  const isEnhc = draft.dealMode === DEAL_MODES.ENHC;
  return [
    { name: 'decks', labelKey: 'settings.decks', options: [1, 2, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) })) },
    {
      name: 'dealMode',
      labelKey: 'settings.dealMode',
      options: [
        { value: 'ENHC', key: 'settings.dealModeENHC' },
        { value: 'AMERICAN_HOLE_CARD', key: 'settings.dealModeAMERICAN_HOLE_CARD' },
      ],
    },
    {
      name: 'dealerHitsSoft17',
      labelKey: 'settings.soft17',
      options: [
        { value: 'false', key: 'settings.soft17Stand' },
        { value: 'true', key: 'settings.soft17Hit' },
      ],
    },
    {
      name: 'blackjackPayout',
      labelKey: 'settings.blackjackPayout',
      options: [
        { value: '3:2', label: '3:2' },
        { value: '6:5', label: '6:5' },
      ],
    },
    { name: 'insuranceEnabled', labelKey: 'settings.insuranceEnabled', options: BOOL_OPTIONS },
    {
      name: 'surrender',
      labelKey: 'settings.surrenderMode',
      // Late surrender needs a peek, which ENHC games do not have.
      options: [
        { value: 'NONE', key: 'settings.surrenderNONE' },
        { value: 'EARLY_SURRENDER', key: 'settings.surrenderEARLY_SURRENDER' },
        ...(isEnhc ? [] : [{ value: 'LATE_SURRENDER', key: 'settings.surrenderLATE_SURRENDER' }]),
      ],
    },
    ...(draft.surrender !== 'NONE'
      ? [{ name: 'surrenderVsAce', labelKey: 'settings.surrenderVsAce', options: BOOL_OPTIONS }]
      : []),
    {
      name: 'doubleRestriction',
      labelKey: 'settings.doubleRestriction',
      options: [
        { value: 'ANY_TWO', key: 'settings.doubleANY_TWO' },
        { value: 'NINE_TO_ELEVEN', key: 'settings.doubleNINE_TO_ELEVEN' },
        { value: 'TEN_ELEVEN', key: 'settings.doubleTEN_ELEVEN' },
      ],
    },
    { name: 'doubleAfterSplit', labelKey: 'settings.doubleAfterSplit', options: BOOL_OPTIONS },
    { name: 'maxSplitHands', labelKey: 'settings.maxSplitHands', options: [2, 3, 4].map((n) => ({ value: String(n), label: String(n) })) },
    {
      name: 'splitPairing',
      labelKey: 'settings.splitPairing',
      options: [
        { value: 'EQUAL_VALUE', key: 'settings.pairingEQUAL_VALUE' },
        { value: 'IDENTICAL_RANK', key: 'settings.pairingIDENTICAL_RANK' },
      ],
    },
    { name: 'resplitAces', labelKey: 'settings.resplitAces', options: BOOL_OPTIONS },
    // Under American rules the peek always protects extra bets, so the
    // loss mode is only a real choice for ENHC games.
    ...(isEnhc
      ? [{
        name: 'dealerBlackjackLossMode',
        labelKey: 'settings.lossMode',
        options: [
          { value: 'ALL_BETS_LOST', key: 'settings.lossALL_BETS_LOST' },
          { value: 'ORIGINAL_BETS_ONLY', key: 'settings.lossORIGINAL_BETS_ONLY' },
        ],
      }]
      : []),
  ];
}

function defaultDraft(state) {
  const base = state.customProfile ?? PROFILES.FRENCH_STANDARD;
  return {
    decks: String(base.decks),
    dealMode: base.dealMode,
    dealerHitsSoft17: String(base.dealerHitsSoft17),
    blackjackPayout: formatRatio(base.blackjackPayout),
    insuranceEnabled: String(base.insuranceEnabled),
    surrender: base.surrender,
    surrenderVsAce: String(base.surrenderVsAce),
    doubleRestriction: base.doubleRestriction,
    doubleAfterSplit: String(base.doubleAfterSplit),
    maxSplitHands: String(base.maxSplitHands),
    splitPairing: base.splitPairing,
    resplitAces: String(base.resplitAces),
    dealerBlackjackLossMode: base.dealerBlackjackLossMode === 'PEEK_PROTECTED'
      ? 'ALL_BETS_LOST'
      : base.dealerBlackjackLossMode,
  };
}

function buildCustomEditor(state) {
  const form = $('custom-editor');
  if (state.profileId !== 'CUSTOM') {
    form.hidden = true;
    customDraft = null;
    return;
  }
  form.hidden = false;
  if (!customDraft) customDraft = defaultDraft(state);
  form.textContent = '';

  const title = document.createElement('h3');
  title.textContent = t('settings.customTitle');
  title.className = 'field field--submit';
  form.append(title);

  for (const field of editorFields(customDraft)) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const id = `custom-${field.name}`;
    const labelId = `${id}-label`;
    // No `for`: the control is a button, which a label cannot target. The
    // button names itself from this element through aria-labelledby.
    const label = document.createElement('label');
    label.id = labelId;
    label.textContent = t(field.labelKey);

    const options = field.options.map((option) => ({
      value: option.value,
      label: option.key ? t(option.key) : option.label,
    }));
    if (!options.some((o) => o.value === customDraft[field.name])) {
      customDraft[field.name] = options[0].value;
    }

    const menu = buildMenuSelect({
      id,
      labelledBy: labelId,
      options,
      value: customDraft[field.name],
      onSelect: (value) => {
        customDraft[field.name] = value;
        controller.audio.settingChanged();
        // Deal mode and surrender changes alter which fields make sense.
        if (field.name === 'dealMode' || field.name === 'surrender') {
          renderSettings();
        }
      },
    });
    // Restores the click-the-label-to-reach-the-control habit `for` gave us.
    label.addEventListener('click', () => menu.root.querySelector('button').focus());

    wrap.append(label, menu.root);
    form.append(wrap);
  }

  const submitWrap = document.createElement('div');
  submitWrap.className = 'field field--submit';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = t('settings.customApply');
  submit.disabled = controller.isRoundActive();
  submitWrap.append(submit);
  form.append(submitWrap);

  form.onsubmit = (event) => {
    event.preventDefault();
    controller.applyCustomSettings(parseDraft(customDraft));
    renderSettings();
  };
}

function parseDraft(draft) {
  return {
    decks: Number(draft.decks),
    dealMode: draft.dealMode,
    dealerHitsSoft17: draft.dealerHitsSoft17 === 'true',
    blackjackPayout: draft.blackjackPayout,
    insuranceEnabled: draft.insuranceEnabled === 'true',
    surrender: draft.surrender,
    surrenderVsAce: draft.surrenderVsAce === 'true',
    doubleRestriction: draft.doubleRestriction,
    doubleAfterSplit: draft.doubleAfterSplit === 'true',
    maxSplitHands: Number(draft.maxSplitHands),
    splitPairing: draft.splitPairing,
    resplitAces: draft.resplitAces === 'true',
    dealerBlackjackLossMode: draft.dealerBlackjackLossMode,
  };
}

/* -------------------------------------------------------- bankroll dialog */

/**
 * The starting bankroll is locked mid-round: applying it would wipe a hand
 * that already holds committed bets.
 */
function renderBankrollButton() {
  const locked = controller.isRoundActive();
  const button = $('btn-set-bankroll');
  button.textContent = t('settings.setBankroll');
  button.disabled = locked;
  const note = $('bankroll-locked-note');
  note.textContent = t('settings.bankrollLocked');
  note.hidden = !locked;
}

function openBankrollDialog() {
  const current = controller.getStartingBankrollCents();

  $('bankroll-title').textContent = t('settings.bankrollTitle');
  $('bankroll-warning').textContent = t('settings.bankrollWarning');
  $('bankroll-amount-label').textContent = t('settings.bankrollLabel');
  $('bankroll-hint').textContent = t('settings.bankrollHint', {
    min: formatMoney(MIN_BANKROLL_CENTS),
    max: formatMoney(MAX_BANKROLL_CENTS),
  });
  $('btn-bankroll-cancel').textContent = t('settings.bankrollCancel');
  $('btn-bankroll-confirm').textContent = t('settings.bankrollApply');

  // Pre-filled with the amount in force, so confirming without editing is a
  // no-op rather than a surprise.
  const input = $('bankroll-amount');
  input.value = String(current / CENTS_PER_UNIT);
  clearBankrollError();

  controller.audio.dialogOpened();
  $('dialog-bankroll').showModal();
  input.select();
}

function clearBankrollError() {
  const error = $('bankroll-error');
  error.hidden = true;
  error.textContent = '';
  $('bankroll-amount').removeAttribute('aria-invalid');
}

function showBankrollError(key, params) {
  const error = $('bankroll-error');
  error.textContent = t(key, params);
  error.hidden = false;
  const input = $('bankroll-amount');
  input.setAttribute('aria-invalid', 'true');
  input.focus();
  controller.audio.actionRejected();
}

function submitBankroll(event) {
  event.preventDefault();

  const parsed = parseStartingBankroll($('bankroll-amount').value);
  if (!parsed.ok) {
    showBankrollError(parsed.errorKey, {
      min: formatMoney(MIN_BANKROLL_CENTS),
      max: formatMoney(MAX_BANKROLL_CENTS),
    });
    return;
  }

  // The round may have started between opening the dialog and confirming.
  if (controller.isRoundActive()) {
    showBankrollError('errors.bankrollRoundActive', {});
    return;
  }

  $('dialog-bankroll').close();
  $('dialog-settings').close();
  controller.setStartingBankroll(parsed.cents);
}

/* -------------------------------------------------------------- help body */

export function renderHelp() {
  const state = controller.getState();
  const profile = state.activeProfile;
  $('help-title').textContent = t('help.title');
  const body = $('help-body');
  body.textContent = '';

  // Two columns on wide screens (CSS collapses them to one below the
  // breakpoint): rules of play on the left, this-table facts on the right.
  const columns = document.createElement('div');
  columns.className = 'help-columns';
  const left = document.createElement('div');
  left.className = 'help-col';
  const right = document.createElement('div');
  right.className = 'help-col';
  columns.append(left, right);
  body.append(columns);

  const section = (column, titleText) => {
    const wrap = document.createElement('section');
    wrap.className = 'help-section';
    const h = document.createElement('h3');
    h.textContent = titleText;
    wrap.append(h);
    column.append(wrap);
    return wrap;
  };

  const paragraph = (parent, text, className) => {
    const p = document.createElement('p');
    if (className) p.className = className;
    p.textContent = text;
    parent.append(p);
  };

  paragraph(section(left, t('help.goal')), t('help.goalBody'));
  paragraph(section(left, t('help.blackjack')), t('help.blackjackBody'));

  const actionsSection = section(left, t('help.actionsTitle'));
  const actionList = document.createElement('ul');
  actionList.className = 'help-list';
  const actionRows = [
    ['actions.HIT', 'help.hitBody'],
    ['actions.STAND', 'help.standBody'],
    ['actions.DOUBLE', 'help.doubleBody'],
    ['actions.SPLIT', 'help.splitBody'],
    ['actions.SURRENDER', 'help.surrenderBody'],
  ];
  for (const [nameKey, bodyKey] of actionRows) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = `${t(nameKey)} : `;
    li.append(strong, document.createTextNode(t(bodyKey)));
    actionList.append(li);
  }
  actionsSection.append(actionList);

  paragraph(section(left, t('help.insuranceTitle')), t('help.insuranceBody'));

  const tableSection = section(
    right,
    `${t('help.tableTitle')} : ${t(`profiles.${state.profileId}.name`)}`
  );
  paragraph(tableSection, profileSummaryChips(profile).join(' · '));
  paragraph(tableSection, t('profiles.presetNote'), 'fine-print');

  const shortcutsSection = section(right, t('help.shortcutsTitle'));
  const shortcutList = document.createElement('ul');
  shortcutList.className = 'shortcut-list';
  const shortcuts = [
    ['H', t('help.shortcutHit')],
    ['S', t('help.shortcutStand')],
    ['D', t('help.shortcutDouble')],
    ['P', t('help.shortcutSplit')],
    ['R', t('help.shortcutSurrender')],
    ['N', t('help.shortcutDeal')],
  ];
  for (const [key, label] of shortcuts) {
    const li = document.createElement('li');
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    li.append(kbd, document.createTextNode(` ${label}`));
    shortcutList.append(li);
  }
  shortcutsSection.append(shortcutList);

  paragraph(right, t('help.fairness'), 'fine-print');
}
