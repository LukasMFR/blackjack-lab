import { t } from '../i18n/index.js';
import { formatMoney } from './format.js';
import { profileSummaryChips } from './profileSummary.js';
import { SHORTCUT_KEYS } from './keyboardShortcuts.js';

/**
 * The "Rules and help" dialog body, shared by the solo table and the local
 * multiplayer room. The caller describes the table being documented; nothing
 * here reads game state.
 *
 * @typedef {object} HelpFacts
 * @property {'solo'|'multiplayer'} mode
 * @property {string|null} profileId - active rule profile, when known
 * @property {object|null} profile - resolved profile for the summary chips
 *   (null on multiplayer clients using a custom profile they cannot resolve)
 * @property {number|null} [minBetCents] - multiplayer table minimum
 * @property {number|null} [maxBetCents] - multiplayer table maximum
 */

/**
 * @param {HTMLElement} body - the emptied dialog body to fill
 * @param {HelpFacts} facts
 */
export function renderHelpBody(body, facts) {
  const isMultiplayer = facts.mode === 'multiplayer';
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

  if (isMultiplayer) {
    const mpSection = section(left, t('help.mpTitle'));
    paragraph(mpSection, t('help.mpBody1'));
    paragraph(mpSection, t('help.mpBody2'));
  }

  if (facts.profileId) {
    const tableSection = section(
      right,
      `${t('help.tableTitle')} : ${t(`profiles.${facts.profileId}.name`)}`
    );
    if (facts.profile) {
      paragraph(tableSection, profileSummaryChips(facts.profile).join(' · '));
    }
    if (isMultiplayer && facts.minBetCents != null && facts.maxBetCents != null) {
      paragraph(tableSection, t('bet.tableRange', {
        min: formatMoney(facts.minBetCents),
        max: formatMoney(facts.maxBetCents),
      }));
    }
    paragraph(tableSection, t('profiles.presetNote'), 'fine-print');
  } else {
    // Multiplayer menu screen: no room yet, so no table to document.
    paragraph(section(right, t('help.tableTitle')), t('help.mpNoRoom'));
  }

  const shortcutsSection = section(right, t('help.shortcutsTitle'));
  const shortcutList = document.createElement('ul');
  shortcutList.className = 'shortcut-list';
  const shortcuts = [
    [SHORTCUT_KEYS.HIT, t('help.shortcutHit')],
    [SHORTCUT_KEYS.STAND, t('help.shortcutStand')],
    [SHORTCUT_KEYS.DOUBLE, t('help.shortcutDouble')],
    [SHORTCUT_KEYS.SPLIT, t('help.shortcutSplit')],
    [SHORTCUT_KEYS.SURRENDER, t('help.shortcutSurrender')],
    [SHORTCUT_KEYS.DEAL, t(isMultiplayer ? 'help.shortcutDealMp' : 'help.shortcutDeal')],
    [SHORTCUT_KEYS.INSURANCE_ACCEPT, t('help.shortcutInsuranceAccept')],
    [SHORTCUT_KEYS.INSURANCE_DECLINE, t('help.shortcutInsuranceDecline')],
  ];
  for (const [key, label] of shortcuts) {
    const li = document.createElement('li');
    const kbd = document.createElement('kbd');
    kbd.textContent = key.toUpperCase();
    li.append(kbd, document.createTextNode(` ${label}`));
    shortcutList.append(li);
  }
  shortcutsSection.append(shortcutList);

  paragraph(right, t('help.fairness'), 'fine-print');
}
