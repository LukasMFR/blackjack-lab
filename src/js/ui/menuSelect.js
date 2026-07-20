/**
 * Themed dropdown: a button plus a listbox, standing in for a native <select>
 * so that the closed control and the open menu both follow the active theme.
 *
 * Follows the ARIA "select-only combobox" pattern: DOM focus stays on the
 * button and the active option is published through aria-activedescendant,
 * which keeps Escape/Tab handling simple and leaves one focus stop per
 * control, exactly as a native select has.
 *
 * Two entry points share one behaviour core:
 *   bindMenuSelect: drive markup that already exists (the header globe).
 *   buildMenuSelect: create the standard markup, then drive it.
 *
 * The panel is positioned as a fixed element rather than an absolute one so
 * it escapes scroll containers: the custom-rules editor lives inside the
 * settings dialog's scrolling body, which would otherwise clip it. Fixed
 * placement then has to be maintained by hand; see trackAnchor.
 *
 * This module owns presentation only. Chosen values are reported through
 * onSelect and no caller state is touched.
 */

/** Gap between trigger and panel; mirrors --space-2. */
const MENU_GAP_PX = 8;

/** Tallest the panel may grow before it scrolls; mirrors the CSS max-height. */
const MENU_MAX_HEIGHT_PX = 288;

/** How long consecutive keystrokes count as one typeahead search. */
const TYPEAHEAD_RESET_MS = 500;

/** Keys that open a closed menu, each landing on the selected option. */
const OPENING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

const CHEVRON_SVG = '<svg class="menu-select__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

const CHECK_SVG = '<svg class="menu-select__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

/**
 * Attach dropdown behaviour to existing markup.
 *
 * @param {{ root: HTMLElement, onSelect: (value: string) => void }} config
 *   root must contain .menu-select__button, .menu-select__list, a
 *   .menu-select__value element, and [role="option"] items carrying
 *   data-value and an id. onSelect fires only on an actual change;
 *   onValueShown fires whenever the displayed value changes, for triggers
 *   that carry extra chrome (a code, a tooltip) beside the value.
 * @returns {{ setValue: (value: string) => void, close: () => void }}
 */
export function bindMenuSelect({ root, onSelect, onValueShown }) {
  const button = root.querySelector('.menu-select__button');
  const listbox = root.querySelector('.menu-select__list');
  const valueEl = root.querySelector('.menu-select__value');
  const optionEls = [...listbox.querySelectorAll('[role="option"]')];

  let isOpen = false;
  let activeIndex = 0;
  let selectedIndex = 0;
  let typeahead = '';
  let typeaheadTimer = 0;
  let trackingFrame = 0;
  let lastAnchor = '';

  /* ------------------------------------------------------------ placement */

  // Fixed placement has to be recomputed by hand: below the trigger when
  // there is room, flipped above when there is not, clamped to the viewport.
  function reposition() {
    const rect = button.getBoundingClientRect();
    listbox.style.minWidth = `${rect.width}px`;

    const below = window.innerHeight - rect.bottom - MENU_GAP_PX * 2;
    const above = rect.top - MENU_GAP_PX * 2;
    const flipUp = below < listbox.scrollHeight && above > below;

    listbox.style.maxHeight = `${Math.min(MENU_MAX_HEIGHT_PX, flipUp ? above : below)}px`;
    const height = listbox.offsetHeight;
    listbox.style.top = flipUp
      ? `${rect.top - height - MENU_GAP_PX}px`
      : `${rect.bottom + MENU_GAP_PX}px`;

    const maxLeft = window.innerWidth - listbox.offsetWidth - MENU_GAP_PX;
    listbox.style.left = `${Math.max(MENU_GAP_PX, Math.min(rect.left, maxLeft))}px`;
  }

  /*
   * Keep the panel glued to its trigger while open. This watches the anchor
   * rather than listening for scroll and resize: the trigger can move for
   * reasons neither event reports (a scrolling ancestor, a reflow above it),
   * and re-measuring only repositions when something actually moved.
   */
  function trackAnchor() {
    // A settings re-render can replace an open menu's markup; without this the
    // loop would keep measuring a detached node for the life of the page.
    if (!button.isConnected) {
      closeMenu({ restoreFocus: false });
      return;
    }

    const rect = button.getBoundingClientRect();
    const anchor = `${rect.top}:${rect.left}:${rect.width}`;
    if (anchor !== lastAnchor) {
      lastAnchor = anchor;
      reposition();
    }
    trackingFrame = requestAnimationFrame(trackAnchor);
  }

  /* ----------------------------------------------------------- open state */

  function openMenu() {
    // Safari and Firefox do not focus a button on click, and the whole
    // keyboard model hangs off the button holding focus, so take it.
    button.focus();
    isOpen = true;
    listbox.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    reposition();
    setActive(selectedIndex);

    // Both of these live only while open, so a menu rebuilt on every settings
    // render (the custom-rules editor) leaks nothing.
    lastAnchor = '';
    trackingFrame = requestAnimationFrame(trackAnchor);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
  }

  function closeMenu({ restoreFocus = true } = {}) {
    isOpen = false;
    listbox.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    optionEls[activeIndex]?.classList.remove('is-active');

    cancelAnimationFrame(trackingFrame);
    document.removeEventListener('pointerdown', handleDocumentPointerDown);

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

  /** Show option `index` as the current choice. */
  function applySelection(index) {
    selectedIndex = index;
    optionEls.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    valueEl.textContent = optionEls[index].querySelector('span').textContent;
    onValueShown?.(optionEls[index]);
  }

  /**
   * Close and, when the value actually changed, report it upward. The control
   * updates itself first: a caller may keep the value in a draft it does not
   * re-render from, exactly as a native select would not need it to.
   */
  function commit(index) {
    const value = optionEls[index].dataset.value;
    const changed = index !== selectedIndex;
    applySelection(index);
    closeMenu();
    if (changed) onSelect(value);
  }

  /* --------------------------------------------------------------- events */

  function handleDocumentPointerDown(event) {
    if (!root.contains(event.target)) closeMenu({ restoreFocus: false });
  }

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

    // Typeahead, as a native select offers: jump to the first option whose
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
  button.addEventListener('blur', () => {
    if (isOpen) closeMenu({ restoreFocus: false });
  });

  return {
    /**
     * Show `value` as the current choice. Safe to call repeatedly.
     *
     * @param {string} value
     */
    setValue(value) {
      const index = optionEls.findIndex((el) => el.dataset.value === value);
      if (index === -1) throw new Error(`Unknown menu option: ${value}`);
      applySelection(index);
    },

    /** Close without committing; for callers tearing the control down. */
    close() {
      if (isOpen) closeMenu({ restoreFocus: false });
    },
  };
}

/**
 * Build a labelled dropdown and attach behaviour to it.
 *
 * @param {{
 *   id: string,
 *   labelledBy: string,
 *   options: Array<{ value: string, label: string }>,
 *   value: string,
 *   onSelect: (value: string) => void,
 * }} config
 * @returns {{ root: HTMLElement, setValue: (value: string) => void, close: () => void }}
 */
export function buildMenuSelect({ id, labelledBy, options, value, onSelect }) {
  const root = document.createElement('div');
  root.className = 'menu-select menu-select--block';

  const listId = `${id}-listbox`;
  const valueId = `${id}-value`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-select__button';
  button.id = id;
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', listId);
  // Named from the field label plus the value element, so the visible text
  // never has to be excluded from the name computation.
  button.setAttribute('aria-labelledby', `${labelledBy} ${valueId}`);
  button.innerHTML = `<span class="menu-select__value" id="${valueId}"></span>${CHEVRON_SVG}`;

  const listbox = document.createElement('ul');
  listbox.className = 'menu-select__list';
  listbox.id = listId;
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-labelledby', labelledBy);
  listbox.hidden = true;

  options.forEach((option, index) => {
    const item = document.createElement('li');
    item.className = 'menu-select__option';
    item.id = `${id}-option-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.value = option.value;

    const label = document.createElement('span');
    label.textContent = option.label;
    item.append(label);
    item.insertAdjacentHTML('beforeend', CHECK_SVG);
    listbox.append(item);
  });

  root.append(button, listbox);

  // The value can be ellipsised in a narrow column, so the tooltip carries
  // the full text for sighted users; the accessible name always has it.
  const menu = bindMenuSelect({
    root,
    onSelect,
    onValueShown: (option) => { button.title = option.querySelector('span').textContent; },
  });
  menu.setValue(value);
  return { root, ...menu };
}
