import { t } from '../i18n/index.js';
import { formatMoney, formatRatio } from './format.js';
import { profileSummaryChips } from './profileSummary.js';
import { PROFILE_IDS, PROFILES } from '../config/profiles.js';
import { DEAL_MODES } from '../game/constants.js';
import { unitsToCents } from '../game/money.js';

/**
 * Settings and help dialogs. Receives a controller object from app.js and
 * never talks to the engine directly.
 */

const $ = (id) => document.getElementById(id);

let controller = null;
let customDraft = null;

const APPEARANCES = ['system', 'light', 'dark'];
const THEMES = ['classic', 'minimal'];
const LANGUAGE_LABELS = { en: 'English', fr: 'Français' };

/** @param {object} appController */
export function initSettingsView(appController) {
  controller = appController;

  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  for (const button of document.querySelectorAll('[data-close-dialog]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  $('btn-settings').addEventListener('click', () => openSettings());
  $('btn-profile').addEventListener('click', () => openSettings());
  $('btn-help').addEventListener('click', () => {
    renderHelp();
    $('dialog-help').showModal();
  });
  $('btn-reset-bankroll').addEventListener('click', () => {
    renderResetDialog();
    $('dialog-reset').showModal();
  });
  $('btn-reset-cancel').addEventListener('click', () => $('dialog-reset').close());
  $('btn-reset-confirm').addEventListener('click', () => {
    $('dialog-reset').close();
    $('dialog-settings').close();
    controller.resetBankroll();
  });
}

function openSettings() {
  renderSettings();
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
  $('btn-reset-bankroll').textContent = t('settings.resetBankroll');

  buildSegment($('settings-language'), ['en', 'fr'], state.language,
    (value) => LANGUAGE_LABELS[value],
    (value) => controller.setLanguage(value));

  buildSegment($('settings-appearance'), APPEARANCES, state.appearance,
    (value) => t(`settings.appearance${value[0].toUpperCase()}${value.slice(1)}`),
    (value) => controller.setAppearance(value));

  buildSegment($('settings-theme'), THEMES, state.theme,
    (value) => t(value === 'classic' ? 'settings.themeClassic' : 'settings.themeMinimal'),
    (value) => controller.setTheme(value));

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
      onSelect(value);
      renderSettings();
    });
    container.append(option);
  }
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
    const label = document.createElement('label');
    label.setAttribute('for', `custom-${field.name}`);
    label.textContent = t(field.labelKey);
    const select = document.createElement('select');
    select.className = 'select';
    select.id = `custom-${field.name}`;
    for (const option of field.options) {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.key ? t(option.key) : option.label;
      select.append(optionEl);
    }
    if ([...select.options].some((o) => o.value === customDraft[field.name])) {
      select.value = customDraft[field.name];
    } else {
      customDraft[field.name] = select.options[0].value;
    }
    select.addEventListener('change', () => {
      customDraft[field.name] = select.value;
      // Deal mode and surrender changes alter which fields make sense.
      if (field.name === 'dealMode' || field.name === 'surrender') {
        renderSettings();
      }
    });
    wrap.append(label, select);
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

/* ----------------------------------------------------------- reset dialog */

function renderResetDialog() {
  const state = controller.getState();
  $('reset-title').textContent = t('settings.resetTitle');
  $('reset-body').textContent = t('settings.resetBody', {
    amount: formatMoney(unitsToCents(state.activeProfile.startingBankrollUnits)),
  });
  $('btn-reset-cancel').textContent = t('settings.resetCancel');
  $('btn-reset-confirm').textContent = t('settings.resetConfirm');
}

/* -------------------------------------------------------------- help body */

export function renderHelp() {
  const state = controller.getState();
  const profile = state.activeProfile;
  $('help-title').textContent = t('help.title');
  const body = $('help-body');
  body.textContent = '';

  const section = (titleKey, texts) => {
    const h = document.createElement('h3');
    h.textContent = t(titleKey);
    body.append(h);
    for (const text of texts) {
      const p = document.createElement('p');
      p.textContent = text;
      body.append(p);
    }
  };

  section('help.goal', [t('help.goalBody')]);
  section('help.blackjack', [t('help.blackjackBody')]);

  const actionsTitle = document.createElement('h3');
  actionsTitle.textContent = t('help.actionsTitle');
  body.append(actionsTitle);
  const actionList = document.createElement('ul');
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
  body.append(actionList);

  section('help.insuranceTitle', [t('help.insuranceBody')]);

  const tableTitle = document.createElement('h3');
  tableTitle.textContent = `${t('help.tableTitle')} : ${t(`profiles.${state.profileId}.name`)}`;
  body.append(tableTitle);
  const chips = document.createElement('p');
  chips.className = 'fine-print';
  chips.textContent = profileSummaryChips(profile).join(' · ');
  body.append(chips);
  const note = document.createElement('p');
  note.className = 'fine-print';
  note.textContent = t('profiles.presetNote');
  body.append(note);

  const shortcutsTitle = document.createElement('h3');
  shortcutsTitle.textContent = t('help.shortcutsTitle');
  body.append(shortcutsTitle);
  const shortcutList = document.createElement('ul');
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
  body.append(shortcutList);

  const fairness = document.createElement('p');
  fairness.className = 'fine-print';
  fairness.textContent = t('help.fairness');
  body.append(fairness);
}
