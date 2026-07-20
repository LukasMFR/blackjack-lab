/**
 * Audio preference model: defaults, validation, and (de)serialization.
 * Pure data — no Web Audio, no DOM — so it is fully testable in Node.
 */

export const AUDIO_SETTINGS_KEY = 'audio';

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  enabled: true,
  muted: false,
  masterVolume: 0.8,
  musicEnabled: true,
  musicVolume: 0.45,
  ambienceEnabled: true,
  ambienceVolume: 0.5,
  effectsEnabled: true,
  effectsVolume: 0.8,
  uiSoundsEnabled: true,
});

const BOOL_KEYS = ['enabled', 'muted', 'musicEnabled', 'ambienceEnabled', 'effectsEnabled', 'uiSoundsEnabled'];
const VOLUME_KEYS = ['masterVolume', 'musicVolume', 'ambienceVolume', 'effectsVolume'];

/**
 * Coerce arbitrary stored data into a complete, valid settings object.
 * Unknown keys are dropped; invalid values fall back to defaults.
 * @param {unknown} raw
 * @returns {object} complete audio settings
 */
export function sanitizeAudioSettings(raw) {
  const out = { ...DEFAULT_AUDIO_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of BOOL_KEYS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  for (const key of VOLUME_KEYS) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.min(1, Math.max(0, value));
    }
  }
  return out;
}
