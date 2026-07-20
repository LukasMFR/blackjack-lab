/**
 * Interface click for the links that navigate between the solo and
 * multiplayer pages.
 *
 * Those links are the only controls in the header that leave the document.
 * Audio is Web Audio, so a link left to navigate on its own tears the
 * AudioContext down before the click is audible: the sound has to start
 * before the navigation does, which is why the jump is held back briefly
 * rather than simply fired alongside the sound.
 *
 * Mute, the interface-sound preference and the volume settings are not
 * consulted here. uiClick is declared `ui: true` in the audio manifest, so
 * the audio manager already gates and scales it exactly as it does for every
 * other button in the app.
 */

/** Long enough for the click to be heard, short enough to still feel instant. */
const NAV_SOUND_DELAY_MS = 120;

/**
 * Play the shared interface click when `link` is followed, then navigate.
 *
 * @param {HTMLAnchorElement} link - a same-document-replacing navigation link.
 * @param {{ uiClick: () => void }} audio - the page's game-audio facade.
 */
export function bindNavSound(link, audio) {
  link.addEventListener('click', (event) => {
    audio.uiClick();

    // Modified and non-primary clicks open a new tab or window, or download.
    // This document survives those, so the sound plays out on its own and the
    // browser's native behaviour is left untouched.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    setTimeout(() => { window.location.href = link.href; }, NAV_SOUND_DELAY_MS);
  });
}
