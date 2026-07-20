/**
 * Language dropdown: a custom listbox replacing the native <select>, so the
 * closed control and the open menu can both follow the active theme.
 *
 * Follows the ARIA "select-only combobox" pattern: DOM focus stays on the
 * button and the active option is published through aria-activedescendant,
 * which keeps Escape/Tab handling simple and keeps one focus stop in the
 * header, exactly as the native select had.
 *
 * This module owns presentation only — it reports a chosen language through
 * the onSelect callback and never touches game state.
 */

const $ = (id) => document.getElementById(id);

/** Keys that open the closed menu, each landing on the selected option. */
const OPENING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

/** How long consecutive keystrokes count as one typeahead search. */
const TYPEAHEAD_RESET_MS = 500;

let button = null;
let listbox = null;
let valueEl = null;
let optionEls = [];

let isOpen = false;
let activeIndex = 0;
let selectedIndex = 0;
let onSelect = null;

let typeahead = '';
let typeaheadTimer = 0;

/**
 * Wire the header language menu.
 *
 * @param {{ onSelect: (language: string) => void }} config
 *   onSelect fires only when the chosen language differs from the current one.
 */
export function initLanguageMenu(config) {
  onSelect = config.onSelect;

  button = $('language-button');
  listbox = $('language-listbox');
  valueEl = $('language-value');
  optionEls = [...listbox.querySelectorAll('[role="option"]')];

  button.addEventListener('click', () => (isOpen ? closeMenu() : openMenu()));
  button.addEventListener('keydown', handleKeydown);

  // Pointer-down on an option would blur the button and close the menu before
  // the click lands, so focus is held and the click handled below.
  listbox.addEventListener('pointerdown', (event) => event.preventDefault());
  listbox.addEventListener('click', (event) => {
    const index = optionEls.indexOf(event.target.closest('[role="option"]'));
    if (index !== -1) commit(index);
  });
  listbox.addEventListener('pointermove', (event) => {
    const index = optionEls.indexOf(event.target.closest('[role="option"]'));
    if (index !== -1) setActive(index);
  });

  document.addEventListener('pointerdown', (event) => {
    if (isOpen && !event.target.closest('#language-menu')) closeMenu();
  });
  button.addEventListener('blur', () => {
    if (isOpen) closeMenu({ restoreFocus: false });
  });
}

/**
 * Show `language` as the current choice. Safe to call on every render.
 *
 * @param {string} language
 */
export function setLanguageMenuValue(language) {
  const index = optionEls.findIndex((el) => el.dataset.value === language);
  if (index === -1) throw new Error(`Unknown language: ${language}`);

  selectedIndex = index;
  optionEls.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
  valueEl.textContent = optionEls[index].querySelector('span').textContent;
}

/* ------------------------------------------------------------- open state */

function openMenu() {
  isOpen = true;
  listbox.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  setActive(selectedIndex);
}

function closeMenu({ restoreFocus = true } = {}) {
  isOpen = false;
  listbox.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.removeAttribute('aria-activedescendant');
  optionEls[activeIndex]?.classList.remove('is-active');
  if (restoreFocus) button.focus();
}

function setActive(index) {
  optionEls[activeIndex]?.classList.remove('is-active');
  activeIndex = index;
  const option = optionEls[index];
  option.classList.add('is-active');
  button.setAttribute('aria-activedescendant', option.id);
  option.scrollIntoView({ block: 'nearest' });
}

/** Close and, when the value actually changed, report it upward. */
function commit(index) {
  const language = optionEls[index].dataset.value;
  const changed = index !== selectedIndex;
  closeMenu();
  if (changed) onSelect(language);
}

/* --------------------------------------------------------------- keyboard */

function handleKeydown(event) {
  const { key } = event;

  if (!isOpen) {
    if (OPENING_KEYS.has(key)) {
      event.preventDefault();
      openMenu();
    }
    return;
  }

  switch (key) {
    case 'Escape':
      event.preventDefault();
      closeMenu();
      return;
    case 'Enter':
    case ' ':
      event.preventDefault();
      commit(activeIndex);
      return;
    case 'ArrowDown':
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, optionEls.length - 1));
      return;
    case 'ArrowUp':
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
      return;
    case 'Home':
      event.preventDefault();
      setActive(0);
      return;
    case 'End':
      event.preventDefault();
      setActive(optionEls.length - 1);
      return;
    case 'Tab':
      // Move on without committing: leaving a menu should not change state.
      closeMenu({ restoreFocus: false });
      return;
    default:
      break;
  }

  // Typeahead, as the native select offered: jump to the first option whose
  // label starts with what has been typed.
  if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    searchByLabel(key);
  }
}

function searchByLabel(char) {
  window.clearTimeout(typeaheadTimer);
  typeahead += char.toLowerCase();
  typeaheadTimer = window.setTimeout(() => { typeahead = ''; }, TYPEAHEAD_RESET_MS);

  const match = optionEls.findIndex(
    (el) => el.textContent.trim().toLowerCase().startsWith(typeahead),
  );
  if (match !== -1) setActive(match);
}
