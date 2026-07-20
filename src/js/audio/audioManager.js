import { AUDIO_BASE, MUSIC_TRACK, SOUNDS, allSoundFiles } from './manifest.js';
import { sanitizeAudioSettings, DEFAULT_AUDIO_SETTINGS } from './audioSettings.js';
import { createAmbienceEngine } from './ambience.js';

/**
 * Central audio system. Owns the AudioContext, the channel graph, the
 * decoded-buffer cache, background music, and the procedural ambience.
 *
 * Completely independent from the blackjack engine and from the DOM:
 * callers trigger semantic sounds by key ("cardDeal", "resultWin", …)
 * and adjust preferences; nothing here reads game state.
 *
 * Channel graph:
 *   sfx sources ──────────────► effectsGain ─┐
 *   ambience engine ──────────► ambienceGain ─┼─► masterGain ─► muteGain ─► out
 *   music sources ─► duckGain ► musicGain ────┘
 *
 * Browser-autoplay contract: nothing is created until `unlock()` is
 * called from a genuine user gesture. Every public method is safe to
 * call before that (it just does nothing audible).
 */

const MUSIC_CROSSFADE_SEC = 2.5;
const WATCHDOG_MS = 700;
const THROTTLE_MS = 45;
const RAMP_TC = 0.04;

const defaultCreateContext = () => {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

const defaultFetchArrayBuffer = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.arrayBuffer();
};

export class AudioManager {
  #settings;
  #persist;
  #createContext;
  #fetchArrayBuffer;
  #now;
  #random;
  #ctx = null;
  #nodes = null;
  #buffers = new Map();
  #lastPlayed = new Map();
  #userInteracted = false;
  #music = { active: false, token: 0, sources: [], loopStart: 0, loopDur: 0, nextStartTime: 0, watchdog: null };
  #ambience = null;
  #duckRestoreTimer = null;
  #hidden = false;

  /**
   * @param {object} options
   * @param {object} [options.settings] - initial (already stored) settings
   * @param {(settings: object) => void} [options.persist] - called with the
   *   full settings object after every change
   * @param {() => (AudioContext|null)} [options.createContext] - injectable
   *   for tests
   * @param {(url: string) => Promise<ArrayBuffer>} [options.fetchArrayBuffer]
   * @param {() => number} [options.now] - monotonic ms clock
   * @param {() => number} [options.random]
   */
  constructor({
    settings = DEFAULT_AUDIO_SETTINGS,
    persist = () => {},
    createContext = defaultCreateContext,
    fetchArrayBuffer = defaultFetchArrayBuffer,
    now = () => Date.now(),
    random = Math.random,
  } = {}) {
    this.#settings = sanitizeAudioSettings(settings);
    this.#persist = persist;
    this.#createContext = createContext;
    this.#fetchArrayBuffer = fetchArrayBuffer;
    this.#now = now;
    this.#random = random;
  }

  /** @returns {object} current (immutable copy of) settings */
  get settings() {
    return { ...this.#settings };
  }

  /** @returns {boolean} true once a user gesture has unlocked audio */
  get unlocked() {
    return this.#userInteracted;
  }

  /** @returns {boolean} true when an AudioContext exists */
  get contextCreated() {
    return this.#ctx !== null;
  }

  /** @returns {boolean} whether this browser can play audio at all */
  get supported() {
    return Boolean(globalThis.AudioContext ?? globalThis.webkitAudioContext)
      || this.#createContext !== defaultCreateContext;
  }

  /** @returns {boolean} true while background music is running (tests) */
  get musicActive() {
    return this.#music.active;
  }

  /** @returns {boolean} true while the ambience layer is running (tests) */
  get ambienceActive() {
    return this.#ambience?.running ?? false;
  }

  /** True when nothing should reach the speakers. */
  get effectivelySilent() {
    return !this.#settings.enabled || this.#settings.muted;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Must be called from a user gesture (click/keydown). Idempotent.
   * Creates and resumes the AudioContext and starts the background
   * layers the user has enabled.
   */
  unlock() {
    this.#userInteracted = true;
    if (this.#settings.enabled) this.#ensureRunning();
  }

  #ensureRunning() {
    if (!this.#userInteracted || !this.#settings.enabled) return;
    if (!this.#ctx) {
      let ctx = null;
      try {
        ctx = this.#createContext();
      } catch {
        ctx = null;
      }
      if (!ctx) return; // Web Audio unavailable: app stays fully usable
      this.#ctx = ctx;
      this.#buildGraph();
      this.#preloadEffects();
    }
    if (this.#ctx.state === 'suspended' && !this.#hidden) {
      this.#ctx.resume?.()?.catch?.(() => {});
    }
    this.#applyGains();
    if (this.#settings.musicEnabled) this.#startMusic();
    if (this.#settings.ambienceEnabled) this.#startAmbience();
  }

  #buildGraph() {
    const ctx = this.#ctx;
    const master = ctx.createGain();
    const mute = ctx.createGain();
    const music = ctx.createGain();
    const duck = ctx.createGain();
    const ambience = ctx.createGain();
    const effects = ctx.createGain();
    duck.connect(music);
    music.connect(master);
    ambience.connect(master);
    effects.connect(master);
    master.connect(mute);
    mute.connect(ctx.destination);
    mute.gain.value = this.#settings.muted ? 0 : 1;
    this.#nodes = { master, mute, music, duck, ambience, effects };
  }

  #preloadEffects() {
    for (const file of allSoundFiles()) this.#loadBuffer(file);
  }

  /**
   * Attach page-visibility handling: suspend while hidden, resume when
   * visible again (music continues where it left off).
   * @param {Document} doc
   */
  bindVisibility(doc) {
    doc.addEventListener('visibilitychange', () => {
      this.#hidden = doc.visibilityState === 'hidden';
      if (!this.#ctx) return;
      if (this.#hidden) {
        this.#ctx.suspend?.()?.catch?.(() => {});
      } else if (this.#settings.enabled) {
        this.#ctx.resume?.()?.catch?.(() => {});
      }
    });
  }

  // -------------------------------------------------------------- settings

  /**
   * Merge a settings patch, persist it, and apply it live.
   * @param {object} patch - partial audio settings
   */
  updateSettings(patch) {
    const prev = this.#settings;
    const next = sanitizeAudioSettings({ ...prev, ...patch });
    this.#settings = next;
    this.#persist({ ...next });

    if (!next.enabled) {
      if (prev.enabled) this.#shutDownOutput();
      return;
    }
    // Enabled (possibly just now): make sure everything reflects `next`.
    if (this.#userInteracted) this.#ensureRunning();
    if (!this.#ctx) return;

    this.#applyGains();
    if (prev.muted !== next.muted) {
      this.#setGain(this.#nodes.mute.gain, next.muted ? 0 : 1, 0.02);
    }
    if (next.musicEnabled && !this.#music.active) this.#startMusic();
    if (!next.musicEnabled && this.#music.active) this.#stopMusic(0.8);
    if (next.ambienceEnabled && !this.#ambience?.running) this.#startAmbience();
    if (!next.ambienceEnabled && this.#ambience?.running) this.#stopAmbience();
  }

  /** Flip the mute flag (used by the header speaker button). */
  toggleMuted() {
    if (!this.#settings.enabled) {
      // The speaker button also revives fully disabled audio.
      this.updateSettings({ enabled: true, muted: false });
      return;
    }
    this.updateSettings({ muted: !this.#settings.muted });
  }

  /** Restore every audio preference to its default value. */
  restoreDefaults() {
    this.updateSettings({ ...DEFAULT_AUDIO_SETTINGS });
  }

  #shutDownOutput() {
    if (!this.#ctx) return;
    this.#stopMusic(0.3);
    this.#stopAmbience(0.3);
    this.#setGain(this.#nodes.mute.gain, 0, 0.02);
  }

  #applyGains() {
    if (!this.#nodes) return;
    const s = this.#settings;
    this.#setGain(this.#nodes.master.gain, s.masterVolume);
    this.#setGain(this.#nodes.music.gain, s.musicVolume);
    this.#setGain(this.#nodes.ambience.gain, s.ambienceVolume);
    this.#setGain(this.#nodes.effects.gain, s.effectsVolume);
    if (s.enabled) this.#setGain(this.#nodes.mute.gain, s.muted ? 0 : 1, 0.02);
  }

  #setGain(param, value, tc = RAMP_TC) {
    const t = this.#ctx?.currentTime ?? 0;
    try {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(value, t, tc);
    } catch {
      param.value = value;
    }
  }

  // --------------------------------------------------------------- buffers

  async #loadBuffer(file) {
    if (!this.#ctx) return null;
    const existing = this.#buffers.get(file);
    if (existing) {
      return existing.state === 'ready' ? existing : null;
    }
    const entry = { state: 'loading', buffer: null, startOffset: 0 };
    this.#buffers.set(file, entry);
    try {
      const data = await this.#fetchArrayBuffer(AUDIO_BASE + file);
      const buffer = await this.#ctx.decodeAudioData(data);
      entry.buffer = buffer;
      entry.startOffset = findLeadingSilence(buffer);
      entry.state = 'ready';
      return entry;
    } catch (error) {
      // Missing/blocked asset: mark failed once and stay silent. The game
      // must keep working without this file.
      entry.state = 'error';
      console.warn(`Audio asset unavailable: ${file}`, error);
      return null;
    }
  }

  /** @param {string} key @returns {{buffer: object, startOffset: number}|null} */
  getReadyBuffer(key) {
    const def = SOUNDS[key];
    if (!def) return null;
    const ready = def.files
      .map((file) => this.#buffers.get(file))
      .filter((entry) => entry && entry.state === 'ready');
    if (ready.length === 0) return null;
    return ready[Math.floor(this.#random() * ready.length)];
  }

  // ----------------------------------------------------------------- sfx

  /**
   * Play a one-shot sound effect by manifest key.
   * @param {string} key - a key of SOUNDS
   * @param {object} [options]
   * @param {number} [options.delay] - seconds from now
   * @param {number} [options.gainScale] - extra multiplier on the base gain
   * @returns {boolean} true when a sound was actually scheduled
   */
  playSound(key, { delay = 0, gainScale = 1 } = {}) {
    const def = SOUNDS[key];
    if (!def || !this.#ctx || !this.#nodes) return false;
    const s = this.#settings;
    if (!s.enabled || s.muted || !s.effectsEnabled) return false;
    if (def.ui && !s.uiSoundsEnabled) return false;
    if (this.#ctx.state !== 'running') return false;

    // Rapid-fire protection: identical sounds cannot stack within a beat.
    const nowMs = this.#now();
    const last = this.#lastPlayed.get(key) ?? -Infinity;
    if (nowMs - last < THROTTLE_MS) return false;
    this.#lastPlayed.set(key, nowMs);

    const entry = this.#pickEntry(def);
    if (!entry) return false;

    try {
      const source = this.#ctx.createBufferSource();
      source.buffer = entry.buffer;
      const jitter = def.pitchJitter ?? 0;
      if (jitter > 0 && source.playbackRate) {
        source.playbackRate.value = 1 + (this.#random() * 2 - 1) * jitter;
      }
      const level = (def.gain ?? 1) * gainScale
        * (1 + (this.#random() * 2 - 1) * (def.gainJitter ?? 0));
      const gainNode = this.#ctx.createGain();
      gainNode.gain.value = Math.max(0, level);
      source.connect(gainNode);
      gainNode.connect(this.#nodes.effects);
      source.start(this.#ctx.currentTime + Math.max(0, delay), entry.startOffset);
      source.onended = () => {
        try {
          source.disconnect();
          gainNode.disconnect();
        } catch { /* already gone */ }
      };
      if (def.important) this.#duckMusic(delay);
      return true;
    } catch (error) {
      console.warn(`Could not play sound "${key}"`, error);
      return false;
    }
  }

  #pickEntry(def) {
    const candidates = def.files
      .map((file) => this.#buffers.get(file))
      .filter((entry) => entry && entry.state === 'ready');
    if (candidates.length === 0) {
      // Kick off loading for next time; nothing plays now.
      for (const file of def.files) this.#loadBuffer(file);
      return null;
    }
    return candidates[Math.floor(this.#random() * candidates.length)];
  }

  /** A short pleasant sample for the settings "Test sound" button. */
  playTestSound() {
    if (!this.playSound('chipStack')) return false;
    this.playSound('resultWin', { delay: 0.25 });
    return true;
  }

  // ------------------------------------------------------------- ducking

  #duckMusic(delay = 0) {
    if (!this.#music.active || !this.#nodes) return;
    const t = this.#ctx.currentTime + delay;
    const { gain } = this.#nodes.duck;
    try {
      gain.cancelScheduledValues(t);
      gain.setTargetAtTime(0.35, t, 0.08);
    } catch { /* non-fatal */ }
    if (this.#duckRestoreTimer) clearTimeout(this.#duckRestoreTimer);
    this.#duckRestoreTimer = setTimeout(() => {
      this.#duckRestoreTimer = null;
      if (!this.#ctx || !this.#nodes) return;
      try {
        this.#nodes.duck.gain.setTargetAtTime(1, this.#ctx.currentTime, 0.5);
      } catch { /* non-fatal */ }
    }, (delay + 1.6) * 1000);
  }

  // --------------------------------------------------------------- music

  async #startMusic() {
    if (this.#music.active || !this.#ctx) return;
    this.#music.active = true;
    const token = ++this.#music.token;
    const entry = await this.#loadBuffer(MUSIC_TRACK);
    // The world may have changed while the 3 MB track was loading.
    if (!entry || token !== this.#music.token || !this.#music.active
      || !this.#settings.musicEnabled || !this.#settings.enabled) {
      if (token === this.#music.token && !entry) this.#music.active = false;
      return;
    }
    const buffer = entry.buffer;
    this.#music.loopStart = entry.startOffset;
    this.#music.loopDur = Math.max(4, buffer.duration - entry.startOffset - 0.1);

    const startAt = this.#ctx.currentTime + 0.05;
    this.#startMusicSource(startAt, 1.4);
    this.#music.nextStartTime = startAt + this.#music.loopDur - MUSIC_CROSSFADE_SEC;
    this.#music.watchdog = setInterval(() => this.#musicWatchdog(), WATCHDOG_MS);
  }

  /**
   * One pass of the seamless-loop scheduler: when the current pass of the
   * track approaches its end, overlap the next pass with an equal fade so
   * the loop point never clicks. Timing uses AudioContext time, so a
   * suspended (hidden) page simply pauses the schedule.
   */
  #musicWatchdog() {
    if (!this.#music.active || !this.#ctx) return;
    this.#music.sources = this.#music.sources.filter((s) => !s.done);
    if (this.#ctx.currentTime >= this.#music.nextStartTime - 1.5) {
      this.#startMusicSource(this.#music.nextStartTime, MUSIC_CROSSFADE_SEC);
      this.#music.nextStartTime += this.#music.loopDur - MUSIC_CROSSFADE_SEC;
    }
  }

  #startMusicSource(when, fadeIn) {
    const entry = this.#buffers.get(MUSIC_TRACK);
    if (!entry || entry.state !== 'ready') return;
    try {
      const source = this.#ctx.createBufferSource();
      source.buffer = entry.buffer;
      const gainNode = this.#ctx.createGain();
      const { loopStart, loopDur } = this.#music;
      const end = when + loopDur;
      gainNode.gain.setValueAtTime(0, when);
      gainNode.gain.linearRampToValueAtTime(1, when + fadeIn);
      gainNode.gain.setValueAtTime(1, end - MUSIC_CROSSFADE_SEC);
      gainNode.gain.linearRampToValueAtTime(0, end);
      source.connect(gainNode);
      gainNode.connect(this.#nodes.duck);
      source.start(when, loopStart);
      source.stop(end + 0.1);
      const record = { source, gainNode, done: false };
      source.onended = () => {
        record.done = true;
        try {
          source.disconnect();
          gainNode.disconnect();
        } catch { /* already gone */ }
      };
      this.#music.sources.push(record);
    } catch (error) {
      console.warn('Music playback failed', error);
    }
  }

  #stopMusic(fadeSec = 0.6) {
    const music = this.#music;
    music.active = false;
    music.token += 1;
    if (music.watchdog) {
      clearInterval(music.watchdog);
      music.watchdog = null;
    }
    const t = this.#ctx?.currentTime ?? 0;
    for (const { source, gainNode } of music.sources) {
      try {
        gainNode.gain.cancelScheduledValues(t);
        gainNode.gain.setTargetAtTime(0, t, fadeSec / 3);
        source.stop(t + fadeSec + 0.1);
      } catch { /* already stopped */ }
    }
    music.sources = [];
  }

  // ------------------------------------------------------------- ambience

  #startAmbience() {
    if (!this.#ctx || this.#ambience?.running) return;
    if (!this.#ambience) {
      this.#ambience = createAmbienceEngine({
        ctx: this.#ctx,
        output: this.#nodes.ambience,
        getOneshot: () => this.#randomAmbientEntry(),
        random: this.#random,
      });
    }
    this.#ambience.start();
  }

  #randomAmbientEntry() {
    const pool = [];
    for (const key of ['chipHandle', 'chipAdd', 'chipCollide', 'cardDeal', 'cardShove', 'chipStack']) {
      const entry = this.getReadyBuffer(key);
      if (entry) pool.push(entry);
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(this.#random() * pool.length)];
  }

  #stopAmbience(fadeSec = 0.8) {
    this.#ambience?.stop(fadeSec);
  }

  /** Tear everything down (used by tests). */
  dispose() {
    this.#stopMusic(0);
    this.#stopAmbience(0);
    if (this.#duckRestoreTimer) clearTimeout(this.#duckRestoreTimer);
    try {
      this.#ctx?.close?.();
    } catch { /* ignore */ }
    this.#ctx = null;
    this.#nodes = null;
    this.#buffers.clear();
  }
}

/**
 * Find where actual signal starts, so MP3 encoder padding never delays a
 * short effect. Capped at 200 ms for safety.
 * @param {AudioBuffer} buffer
 * @returns {number} seconds
 */
function findLeadingSilence(buffer) {
  try {
    const data = buffer.getChannelData(0);
    const limit = Math.min(data.length, Math.floor(buffer.sampleRate * 0.2));
    for (let i = 0; i < limit; i += 1) {
      if (Math.abs(data[i]) > 0.003) return i / buffer.sampleRate;
    }
    return 0;
  } catch {
    return 0;
  }
}
