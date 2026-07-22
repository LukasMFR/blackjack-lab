/**
 * Audio asset manifest: every sound the app can play, with its files,
 * mixing level, and playful-but-subtle variation ranges.
 *
 * A sound key is what the rest of the app refers to; the manifest is the
 * only place that knows about actual files. Multiple files on one key are
 * interchangeable variants (picked at random so frequent sounds never
 * become mechanically repetitive).
 *
 * Fields per sound:
 * - files:       variant file paths, relative to the audio base directory
 * - gain:        base level (0..1) applied on the effects channel
 * - pitchJitter: max random playbackRate deviation (0.03 = ±3%)
 * - gainJitter:  max random level deviation (0.1 = ±10%)
 * - ui:          true for interface feedback gated by the separate
 *                "interface sounds" preference
 * - important:   result-class sounds that duck the music while they play
 */

export const AUDIO_BASE = 'src/assets/audio/';

export const MUSIC_TRACK = 'music/lobby-time.mp3';

export const SOUNDS = Object.freeze({
  // Cards
  cardDeal: {
    files: ['cards/deal-1.mp3', 'cards/deal-2.mp3', 'cards/deal-3.mp3', 'cards/deal-4.mp3'],
    gain: 0.85, pitchJitter: 0.04, gainJitter: 0.12,
  },
  cardReveal: {
    files: ['cards/reveal-1.mp3', 'cards/reveal-2.mp3'],
    gain: 0.9, pitchJitter: 0.03, gainJitter: 0.08,
  },
  cardShove: {
    files: ['cards/shove-1.mp3', 'cards/shove-2.mp3'],
    gain: 0.8, pitchJitter: 0.04, gainJitter: 0.1,
  },
  shuffle: {
    files: ['cards/shuffle.mp3'],
    gain: 0.7, pitchJitter: 0.02, gainJitter: 0.05,
  },

  // Chips
  chipAdd: {
    files: ['chips/add-1.mp3', 'chips/add-2.mp3', 'chips/add-3.mp3'],
    gain: 0.9, pitchJitter: 0.05, gainJitter: 0.12,
  },
  chipStack: {
    files: ['chips/stack-1.mp3', 'chips/stack-2.mp3'],
    gain: 0.9, pitchJitter: 0.04, gainJitter: 0.1,
  },
  chipCollide: {
    files: ['chips/collide-1.mp3', 'chips/collide-2.mp3'],
    gain: 0.85, pitchJitter: 0.04, gainJitter: 0.1,
  },
  chipHandle: {
    files: ['chips/handle-1.mp3', 'chips/handle-2.mp3'],
    gain: 0.8, pitchJitter: 0.03, gainJitter: 0.1,
  },

  // Round results (one per resolved round; these duck the music briefly)
  resultBlackjack: { files: ['results/blackjack.mp3'], gain: 1.0, important: true },
  resultWin: { files: ['results/win.mp3'], gain: 0.9, important: true },
  resultPush: { files: ['results/push.mp3'], gain: 0.8, important: true },
  resultLoss: { files: ['results/loss.mp3'], gain: 0.85, important: true },
  bust: {
    files: ['results/bust-1.mp3', 'results/bust-2.mp3'],
    gain: 0.9, pitchJitter: 0.03, gainJitter: 0.08,
  },
  knock: { files: ['results/knock.mp3'], gain: 0.85, pitchJitter: 0.03, gainJitter: 0.1 },

  // Interface (gated by the "interface sounds" preference)
  uiClick: {
    files: ['ui/click-1.mp3', 'ui/click-2.mp3', 'ui/click-3.mp3'],
    gain: 0.4, pitchJitter: 0.03, gainJitter: 0.1, ui: true,
  },
  uiToggle: {
    files: ['ui/toggle-1.mp3', 'ui/toggle-2.mp3'],
    gain: 0.4, pitchJitter: 0.03, gainJitter: 0.08, ui: true,
  },
  uiOpen: { files: ['ui/open.mp3'], gain: 0.4, ui: true },
  uiClose: { files: ['ui/close.mp3'], gain: 0.35, ui: true },
  uiInvalid: { files: ['ui/invalid.mp3'], gain: 0.65, ui: true },
  // The positive counterpart of uiInvalid: a pairing QR code was read and
  // accepted. Levelled to match it so the two answers feel like a pair.
  uiScanSuccess: { files: ['ui/scan-success.mp3'], gain: 0.6, ui: true },
});

/**
 * Sounds reused (heavily filtered and attenuated) by the procedural
 * casino-room ambience as sparse, distant table activity.
 */
export const AMBIENT_ONESHOT_KEYS = Object.freeze([
  'chipHandle', 'chipAdd', 'chipCollide', 'cardDeal', 'cardShove', 'chipStack',
]);

/** Every distinct sound file (used for preloading). */
export function allSoundFiles() {
  const files = new Set();
  for (const def of Object.values(SOUNDS)) {
    for (const file of def.files) files.add(file);
  }
  return [...files];
}
