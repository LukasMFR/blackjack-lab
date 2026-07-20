import { test, assert, assertEqual } from './runner.js';
import { installFakeDom, makeEvent, dispatch, FakeElement } from './fakeDom.js';
import { bindMenuSelect } from '../src/js/ui/menuSelect.js';

/*
 * These cover the gesture the Safari bug lived in: pressing a trigger whose
 * menu is already open. The full pointerdown -> pointerup -> click sequence is
 * always dispatched, because the bug only appears when the document-level
 * outside-click handler and the trigger's own click both run for one gesture.
 */

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
];

/** Build the hand-written header markup that bindMenuSelect drives. */
function buildMenu(document, id = 'language') {
  const root = new FakeElement('div');
  root.className = 'menu-select';
  root.id = `${id}-menu`;

  const button = new FakeElement('button');
  button.className = 'menu-select__button';
  button.id = `${id}-button`;
  button.setAttribute('aria-expanded', 'false');

  // The trigger has children, so a press can land on one of them rather than
  // on the button itself, exactly as it does on a real globe icon.
  const glyph = new FakeElement('svg');
  glyph.className = 'menu-select__globe';
  const value = new FakeElement('span');
  value.className = 'menu-select__value';
  value.id = `${id}-value`;
  button.append(glyph, value);

  const listbox = new FakeElement('ul');
  listbox.className = 'menu-select__list';
  listbox.id = `${id}-listbox`;
  listbox.hidden = true;

  const optionEls = LANGUAGES.map((option, index) => {
    const item = new FakeElement('li');
    item.className = 'menu-select__option';
    item.id = `${id}-option-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.value = option.value;
    const label = new FakeElement('span');
    label.textContent = option.label;
    item.append(label);
    return item;
  });
  listbox.append(...optionEls);

  root.append(button, listbox);
  document.append(root);
  return {
    root, button, glyph, listbox, optionEls,
  };
}

/**
 * Bind a menu and record every aria-expanded write, so a gesture that closes
 * and immediately reopens is visible rather than hidden by the final state.
 */
function harness(document, id = 'language') {
  const parts = buildMenu(document, id);
  const selected = [];
  const menu = bindMenuSelect({ root: parts.root, onSelect: (value) => selected.push(value) });
  menu.setValue('en');

  const transitions = [];
  const original = parts.button.setAttribute.bind(parts.button);
  parts.button.setAttribute = (name, value) => {
    if (name === 'aria-expanded') transitions.push(value);
    original(name, value);
  };
  return {
    ...parts, menu, selected, transitions,
  };
}

/**
 * One full pointer gesture. retargetTo reproduces Safari reporting an
 * event.target that is not the pressed element, while the composed path
 * stays truthful.
 */
function press(node, { pointerType = 'mouse', retargetTo } = {}) {
  const shared = { pointerType, isPrimary: true, pointerId: 1 };
  dispatch(node, makeEvent('pointerdown', shared), { retargetTo });
  dispatch(node, makeEvent('pointerup', shared), { retargetTo });
  // Touch-derived clicks report detail 0; mouse clicks report a click count.
  dispatch(node, makeEvent('click', { ...shared, detail: pointerType === 'touch' ? 0 : 1 }), { retargetTo });
}

const isOpen = (menu) => menu.button.getAttribute('aria-expanded') === 'true' && !menu.listbox.hidden;

/* ------------------------------------------------------------- open/close */

test('menuSelect: a pointer gesture on a closed trigger opens it', () => {
  const document = installFakeDom();
  const menu = harness(document);

  press(menu.button);

  assert(isOpen(menu), 'menu should be open');
  assertEqual(menu.transitions.join(','), 'true', 'exactly one state change');
});

test('menuSelect: a pointer gesture on an open trigger closes it exactly once', () => {
  const document = installFakeDom();
  const menu = harness(document);

  press(menu.button);
  menu.transitions.length = 0;
  press(menu.button);

  assert(!isOpen(menu), 'menu should be closed');
  assertEqual(menu.transitions.join(','), 'false', 'must not close then reopen');
});

test('menuSelect: a touch gesture on an open trigger closes it exactly once', () => {
  const document = installFakeDom();
  const menu = harness(document);

  press(menu.button, { pointerType: 'touch' });
  menu.transitions.length = 0;
  press(menu.button, { pointerType: 'touch' });

  assert(!isOpen(menu), 'menu should be closed after a tap');
  assertEqual(menu.transitions.join(','), 'false', 'a tap must not reopen the menu');
});

test('menuSelect: pressing a child of the trigger closes the open menu once', () => {
  const document = installFakeDom();
  const menu = harness(document);

  press(menu.button);
  menu.transitions.length = 0;
  // The press lands on the globe icon; the click still comes from the button.
  dispatch(menu.glyph, makeEvent('pointerdown', { pointerType: 'mouse' }));
  dispatch(menu.glyph, makeEvent('pointerup', { pointerType: 'mouse' }));
  dispatch(menu.button, makeEvent('click', { pointerType: 'mouse', detail: 1 }));

  assert(!isOpen(menu), 'menu should be closed');
  assertEqual(menu.transitions.join(','), 'false', 'must not close then reopen');
});

/* -------------------------------------------------- the Safari regression */

test('menuSelect: a retargeted pointerdown on the trigger is not an outside click', () => {
  const document = installFakeDom();
  const menu = harness(document);
  press(menu.button);
  menu.transitions.length = 0;

  // Safari's shape: event.target points outside the control, the composed
  // path still contains the trigger. Reading target closed the menu here and
  // let the click reopen it.
  press(menu.button, { retargetTo: document });

  assert(!isOpen(menu), 'menu should be closed after the gesture');
  assertEqual(menu.transitions.join(','), 'false', 'one gesture, one state change');
});

test('menuSelect: a retargeted pointerdown on the panel is not an outside click', () => {
  const document = installFakeDom();
  const menu = harness(document);
  press(menu.button);
  menu.transitions.length = 0;

  dispatch(menu.optionEls[1], makeEvent('pointerdown', { pointerType: 'mouse' }), { retargetTo: document });

  assert(isOpen(menu), 'pressing inside the panel must not close the menu');
  assertEqual(menu.transitions.length, 0, 'no state change from a press inside the panel');
});

test('menuSelect: one gesture cannot close and immediately reopen the menu', () => {
  const document = installFakeDom();
  const menu = harness(document);
  press(menu.button);
  menu.transitions.length = 0;

  // Something else closes the menu mid-gesture, between press and click.
  dispatch(menu.button, makeEvent('pointerdown', { pointerType: 'mouse' }));
  menu.menu.close();
  dispatch(menu.button, makeEvent('pointerup', { pointerType: 'mouse' }));
  dispatch(menu.button, makeEvent('click', { pointerType: 'mouse', detail: 1 }));

  assert(!isOpen(menu), 'the click must not reopen what the gesture closed');
});

/* ------------------------------------------------- outside and one-at-a-time */

test('menuSelect: a genuine outside press closes the menu', () => {
  const document = installFakeDom();
  const menu = harness(document);
  const elsewhere = new FakeElement('div');
  document.append(elsewhere);

  press(menu.button);
  press(elsewhere);

  assert(!isOpen(menu), 'menu should close on an outside press');
});

test('menuSelect: only one menu is open at a time', () => {
  const document = installFakeDom();
  const first = harness(document, 'first');
  const second = harness(document, 'second');

  press(first.button);
  assert(isOpen(first), 'first menu should be open');

  press(second.button);
  assert(!isOpen(first), 'opening the second menu closes the first');
  assert(isOpen(second), 'second menu should be open');
});

/* ------------------------------------------------------ selection and keys */

test('menuSelect: choosing an option closes the menu and reports once', () => {
  const document = installFakeDom();
  const menu = harness(document);

  press(menu.button);
  dispatch(menu.optionEls[1], makeEvent('pointerdown', { pointerType: 'mouse' }));
  dispatch(menu.optionEls[1], makeEvent('pointerup', { pointerType: 'mouse' }));
  dispatch(menu.optionEls[1], makeEvent('click', { pointerType: 'mouse', detail: 1 }));

  assert(!isOpen(menu), 'choosing an option closes the menu');
  assertEqual(menu.selected.join(','), 'fr', 'onSelect fires once with the chosen value');
  assertEqual(menu.optionEls[1].getAttribute('aria-selected'), 'true', 'chosen option is selected');
  assertEqual(menu.optionEls[0].getAttribute('aria-selected'), 'false', 'previous option is deselected');
});

test('menuSelect: keyboard opening, moving and Escape still work', () => {
  const document = installFakeDom();
  const menu = harness(document);

  dispatch(menu.button, makeEvent('keydown', { key: 'ArrowDown' }));
  assert(isOpen(menu), 'ArrowDown opens the menu');
  assertEqual(menu.button.getAttribute('aria-activedescendant'), menu.optionEls[0].id, 'active option published');

  dispatch(menu.button, makeEvent('keydown', { key: 'ArrowDown' }));
  assertEqual(menu.button.getAttribute('aria-activedescendant'), menu.optionEls[1].id, 'ArrowDown moves the active option');

  const focusesBefore = menu.button.focusCount;
  dispatch(menu.button, makeEvent('keydown', { key: 'Escape' }));
  assert(!isOpen(menu), 'Escape closes the menu');
  assertEqual(menu.button.getAttribute('aria-activedescendant'), null, 'active descendant cleared');
  assert(menu.button.focusCount > focusesBefore, 'Escape restores focus to the trigger');
});

test('menuSelect: Enter commits the active option', () => {
  const document = installFakeDom();
  const menu = harness(document);

  dispatch(menu.button, makeEvent('keydown', { key: 'ArrowDown' }));
  dispatch(menu.button, makeEvent('keydown', { key: 'ArrowDown' }));
  dispatch(menu.button, makeEvent('keydown', { key: 'Enter' }));

  assert(!isOpen(menu), 'Enter closes the menu');
  assertEqual(menu.selected.join(','), 'fr', 'Enter commits the active option');
});

test('menuSelect: a stale pointer gesture does not affect a later keyboard click', () => {
  const document = installFakeDom();
  const menu = harness(document);

  press(menu.button);
  // A press that never becomes a click: the pointer left the trigger.
  dispatch(menu.button, makeEvent('pointerdown', { pointerType: 'mouse' }));
  dispatch(menu.button, makeEvent('keydown', { key: 'Escape' }));
  assert(!isOpen(menu), 'Escape closes the menu');

  // A keyboard-driven click carries no gesture and must read the live state.
  dispatch(menu.button, makeEvent('click', { detail: 0 }));
  assert(isOpen(menu), 'the keyboard click opens the closed menu');
});
