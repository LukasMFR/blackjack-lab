/**
 * Header language dropdown. The menu behaviour lives in menuSelect.js; this
 * adapter owns only what is specific to the header trigger, whose markup is
 * hand-written in index.html because it shows a globe and a language code
 * rather than the full option label.
 */

import { bindMenuSelect } from './menuSelect.js';

const $ = (id) => document.getElementById(id);

let menu = null;

/**
 * Wire the header language menu.
 *
 * @param {{ onSelect: (language: string) => void }} config
 *   onSelect fires only when the chosen language differs from the current one.
 */
export function initLanguageMenu(config) {
  const button = $('language-button');
  const codeEl = $('language-code');

  menu = bindMenuSelect({
    root: $('language-menu'),
    onSelect: config.onSelect,
    // The button shows a code; the hidden value span carries the full name
    // into the accessible name, and the tooltip expands the code for sighted
    // users, which is the same split the sound button uses.
    onValueShown: (option) => {
      codeEl.textContent = option.dataset.value.toUpperCase();
      button.title = option.querySelector('span').textContent;
    },
  });
}

/**
 * Show `language` as the current choice. Safe to call on every render.
 *
 * @param {string} language
 */
export function setLanguageMenuValue(language) {
  menu.setValue(language);
}
