import { test, assert, assertEqual } from './runner.js';
import { AudioManager } from '../src/js/audio/audioManager.js';
import { createGameAudio, resultSoundKey } from '../src/js/audio/gameAudio.js';
import { DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings } from '../src/js/audio/audioSettings.js';
import { SOUNDS, allSoundFiles, MUSIC_TRACK } from '../src/js/audio/manifest.js';

/* ------------------------------------------------- fake Web Audio context */

class FakeParam {
  constructor(value = 1) {
    this.value = value;
  }

  setTargetAtTime(value) { this.value = value; }

  setValueAtTime(value) { this.value = value; }

  linearRampToValueAtTime(value) { this.value = value; }

  cancelScheduledValues() {}
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.pan = new FakeParam(0);
    this.connections = [];
  }

  connect(target) { this.connections.push(target); }

  disconnect() {}

  start() { this.startedAt = this.ctx.currentTime; }

  stop() { this.stoppedRequested = true; }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx, 'source');
    this.playbackRate = new FakeParam(1);
    this.buffer = null;
    this.loop = false;
  }

  start(when = 0, offset = 0) {
    this.started = { when, offset };
    this.ctx.startedSources.push(this);
  }
}

class FakeBuffer {
  constructor(duration = 1, sampleRate = 44100) {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.length = Math.max(1, Math.floor(duration * sampleRate));
    this.channels = [new Float32Array(this.length), new Float32Array(this.length)];
    this.channels.forEach((data) => data.fill(0.1)); // non-silent from sample 0
  }

  getChannelData(channel) { return this.channels[channel] ?? this.channels[0]; }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 44100;
    this.destination = new FakeNode(this, 'destination');
    this.startedSources = [];
    this.gains = [];
    this.resumes = 0;
    this.suspends = 0;
  }

  createGain() {
    const node = new FakeNode(this, 'gain');
    this.gains.push(node);
    return node;
  }

  createBufferSource() { return new FakeSource(this); }

  createBiquadFilter() { return new FakeNode(this, 'filter'); }

  createOscillator() { return new FakeNode(this, 'osc'); }

  createStereoPanner() { return new FakeNode(this, 'panner'); }

  createBuffer(channels, length, rate) { return new FakeBuffer(length / rate, rate); }

  // The music track is fetched as a "large" ArrayBuffer (see makeManager),
  // letting tests tell an 8 s music buffer apart from 1 s effect buffers.
  async decodeAudioData(data) { return new FakeBuffer(data.byteLength >= 100 ? 8 : 1); }

  async resume() { this.resumes += 1; this.state = 'running'; }

  async suspend() { this.suspends += 1; this.state = 'suspended'; }

  async close() { this.state = 'closed'; }
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Build an unlocked manager on a fake context with all assets "loaded".
 * @param {object} [options]
 */
function makeManager({ settings = {}, failFiles = [], persist = () => {} } = {}) {
  const ctx = new FakeContext();
  let contextsCreated = 0;
  const manager = new AudioManager({
    settings: { ...DEFAULT_AUDIO_SETTINGS, ...settings },
    persist,
    createContext: () => { contextsCreated += 1; return ctx; },
    fetchArrayBuffer: async (url) => {
      if (failFiles.some((file) => url.includes(file))) throw new Error('404');
      return new ArrayBuffer(url.includes('music/') ? 100 : 8);
    },
    now: (() => { let t = 0; return () => { t += 1000; return t; }; })(),
    random: () => 0.5,
  });
  return { manager, ctx, contextCount: () => contextsCreated };
}

/* --------------------------------------------------------------- settings */

test('audio settings: garbage input falls back to defaults', () => {
  const out = sanitizeAudioSettings({ masterVolume: 'loud', muted: 'yes', bogus: 1 });
  assertEqual(out.masterVolume, DEFAULT_AUDIO_SETTINGS.masterVolume, 'volume');
  assertEqual(out.muted, DEFAULT_AUDIO_SETTINGS.muted, 'muted');
  assertEqual('bogus' in out, false, 'unknown keys dropped');
});

test('audio settings: volumes are clamped to [0, 1]', () => {
  const out = sanitizeAudioSettings({ masterVolume: 7, musicVolume: -2 });
  assertEqual(out.masterVolume, 1);
  assertEqual(out.musicVolume, 0);
});

test('audio settings: null input yields complete defaults', () => {
  const out = sanitizeAudioSettings(null);
  for (const key of Object.keys(DEFAULT_AUDIO_SETTINGS)) {
    assertEqual(out[key], DEFAULT_AUDIO_SETTINGS[key], key);
  }
});

test('manifest: every sound has files and a sane gain', () => {
  for (const [key, def] of Object.entries(SOUNDS)) {
    assert(Array.isArray(def.files) && def.files.length > 0, `${key} has files`);
    assert((def.gain ?? 1) > 0 && (def.gain ?? 1) <= 1.2, `${key} gain in range`);
  }
  assert(allSoundFiles().length >= 25, 'preload list covers the library');
});

/* ---------------------------------------------------------- unlock rules */

test('no AudioContext exists before the first user gesture', () => {
  const { manager, contextCount } = makeManager();
  assertEqual(manager.playSound('cardDeal'), false, 'play before unlock is inert');
  assertEqual(contextCount(), 0, 'no context created');
  assertEqual(manager.contextCreated, false);
  manager.dispose();
});

test('unlock creates one context, resumes it, and is idempotent', async () => {
  const { manager, contextCount } = makeManager();
  manager.unlock();
  manager.unlock();
  manager.unlock();
  await settle();
  assertEqual(contextCount(), 1, 'a single context');
  assert(manager.unlocked);
  manager.dispose();
});

test('unlock while audio is disabled creates nothing until re-enabled', async () => {
  const { manager, contextCount } = makeManager({ settings: { enabled: false } });
  manager.unlock();
  await settle();
  assertEqual(contextCount(), 0, 'disabled audio never builds a context');
  manager.updateSettings({ enabled: true });
  await settle();
  assertEqual(contextCount(), 1, 'enabling after a past gesture unlocks');
  manager.dispose();
});

/* ------------------------------------------------------------------ music */

test('music starts once when enabled and never duplicates', async () => {
  const { manager, ctx } = makeManager();
  manager.unlock();
  await settle();
  const musicSources = () => ctx.startedSources.filter((s) => s.buffer?.duration === 8);
  assertEqual(manager.musicActive, true, 'music running');
  assertEqual(musicSources().length, 1, 'one music source');
  manager.updateSettings({ musicVolume: 0.7 });
  manager.updateSettings({ musicEnabled: true });
  await settle();
  assertEqual(musicSources().length, 1, 'still one music source');
  manager.dispose();
});

test('music can be disabled and re-enabled independently of effects', async () => {
  const { manager, ctx } = makeManager();
  manager.unlock();
  await settle();
  manager.updateSettings({ musicEnabled: false });
  assertEqual(manager.musicActive, false, 'music stopped');
  assertEqual(manager.playSound('cardDeal'), true, 'effects unaffected');
  manager.updateSettings({ musicEnabled: true });
  await settle();
  assertEqual(manager.musicActive, true, 'music resumed');
  const musicSources = ctx.startedSources.filter((s) => s.buffer?.duration === 8);
  assertEqual(musicSources.length, 2, 'a fresh source, not a stack');
  manager.dispose();
});

test('music disabled at startup does not load or play', async () => {
  const { manager, ctx } = makeManager({ settings: { musicEnabled: false } });
  manager.unlock();
  await settle();
  assertEqual(manager.musicActive, false);
  assertEqual(ctx.startedSources.filter((s) => s.buffer?.duration === 8).length, 0);
  manager.dispose();
});

/* --------------------------------------------------------------- ambience */

test('ambience starts with its room bed and stops cleanly', async () => {
  const { manager } = makeManager();
  manager.unlock();
  await settle();
  assertEqual(manager.ambienceActive, true, 'ambience running');
  manager.updateSettings({ ambienceEnabled: false });
  assertEqual(manager.ambienceActive, false, 'ambience stopped');
  manager.updateSettings({ ambienceEnabled: true });
  assertEqual(manager.ambienceActive, true, 'ambience restarted');
  manager.dispose();
});

/* ------------------------------------------------------- volumes and mute */

test('master and channel volumes propagate to their gain nodes', async () => {
  const { manager, ctx } = makeManager();
  manager.unlock();
  await settle();
  manager.updateSettings({
    masterVolume: 0.25, musicVolume: 0.5, ambienceVolume: 0.75, effectsVolume: 1,
  });
  // Destination ← mute ← master ← {music, ambience, effects}.
  const mute = ctx.gains.find((n) => n.connections.includes(ctx.destination));
  assert(mute, 'mute node reaches destination');
  assertEqual(mute.gain.value, 1, 'not muted');
  manager.updateSettings({ muted: true });
  assertEqual(mute.gain.value, 0, 'mute silences everything');
  manager.updateSettings({ muted: false });
  assertEqual(mute.gain.value, 1, 'unmute restores output');
  manager.dispose();
});

test('muted audio refuses to schedule sound effects', async () => {
  const { manager } = makeManager();
  manager.unlock();
  await settle();
  manager.updateSettings({ muted: true });
  assertEqual(manager.playSound('cardDeal'), false, 'muted: no sfx');
  manager.updateSettings({ muted: false });
  assertEqual(manager.playSound('cardDeal'), true, 'unmuted: sfx again');
  manager.dispose();
});

test('toggleMuted revives fully disabled audio', async () => {
  const { manager } = makeManager({ settings: { enabled: false } });
  manager.unlock();
  manager.toggleMuted();
  await settle();
  const s = manager.settings;
  assertEqual(s.enabled, true);
  assertEqual(s.muted, false);
  manager.dispose();
});

/* -------------------------------------------------------------- sfx rules */

test('effects toggle gates gameplay sounds; UI toggle gates only UI sounds', async () => {
  const { manager } = makeManager();
  manager.unlock();
  await settle();
  manager.updateSettings({ uiSoundsEnabled: false });
  assertEqual(manager.playSound('uiClick'), false, 'ui sound gated');
  assertEqual(manager.playSound('cardDeal'), true, 'gameplay sound not gated');
  manager.updateSettings({ uiSoundsEnabled: true, effectsEnabled: false });
  assertEqual(manager.playSound('cardDeal'), false, 'effects channel off');
  assertEqual(manager.playSound('uiClick'), false, 'ui rides the effects channel');
  manager.dispose();
});

test('rapid identical sounds are throttled to one', async () => {
  const ctx = new FakeContext();
  let clock = 0;
  const manager = new AudioManager({
    settings: DEFAULT_AUDIO_SETTINGS,
    createContext: () => ctx,
    fetchArrayBuffer: async () => new ArrayBuffer(8),
    now: () => clock,
    random: () => 0.5,
  });
  manager.unlock();
  await settle();
  const before = ctx.startedSources.length;
  assertEqual(manager.playSound('chipAdd'), true, 'first play accepted');
  assertEqual(manager.playSound('chipAdd'), false, 'same-instant replay dropped');
  clock += 200;
  assertEqual(manager.playSound('chipAdd'), true, 'later replay accepted');
  assertEqual(ctx.startedSources.length, before + 2, 'exactly two sources started');
  manager.dispose();
});

test('disabling variation makes every press identical', async () => {
  // random() would pick the LAST variant and max jitter; with variation
  // off the first variant must play at exactly its base gain and rate 1.
  const ctx = new FakeContext();
  let clock = 0;
  const manager = new AudioManager({
    settings: { ...DEFAULT_AUDIO_SETTINGS, variationEnabled: false },
    createContext: () => ctx,
    fetchArrayBuffer: async (url) => {
      const buf = new ArrayBuffer(url.includes('music/') ? 100 : 8);
      return buf;
    },
    now: () => { clock += 1000; return clock; },
    random: () => 0.999,
  });
  manager.unlock();
  await settle();
  const before = ctx.startedSources.length;
  assertEqual(manager.playSound('chipAdd'), true);
  const source = ctx.startedSources[before];
  assertEqual(source.playbackRate.value, 1, 'no pitch jitter');
  const gainNode = source.connections[0];
  assertEqual(gainNode.gain.value, SOUNDS.chipAdd.gain, 'exact base gain');
  manager.updateSettings({ variationEnabled: true });
  assertEqual(manager.playSound('cardDeal'), true);
  const varied = ctx.startedSources[ctx.startedSources.length - 1];
  assert(varied.playbackRate.value !== 1, 'variation restored');
  manager.dispose();
});

test('a missing audio file is silent, harmless, and non-fatal', async () => {
  const failing = SOUNDS.resultPush.files.concat(SOUNDS.knock.files);
  const { manager } = makeManager({ failFiles: failing });
  manager.unlock();
  await settle();
  assertEqual(manager.playSound('resultPush'), false, 'missing asset: skipped');
  assertEqual(manager.playSound('knock'), false, 'missing asset: skipped');
  assertEqual(manager.playSound('cardDeal'), true, 'other sounds unaffected');
  manager.dispose();
});

test('a completely unavailable Web Audio API leaves the app functional', async () => {
  const manager = new AudioManager({
    settings: DEFAULT_AUDIO_SETTINGS,
    createContext: () => null,
    fetchArrayBuffer: async () => new ArrayBuffer(8),
  });
  manager.unlock();
  await settle();
  assertEqual(manager.playSound('cardDeal'), false, 'silently inert');
  manager.updateSettings({ muted: true });
  manager.toggleMuted();
  manager.dispose();
});

/* ------------------------------------------------------------ persistence */

test('every settings change is persisted as a complete object', async () => {
  const saved = [];
  const { manager } = makeManager({ persist: (s) => saved.push(s) });
  manager.updateSettings({ masterVolume: 0.3 });
  manager.toggleMuted();
  manager.restoreDefaults();
  assertEqual(saved.length, 3, 'three writes');
  assertEqual(saved[0].masterVolume, 0.3);
  assertEqual(saved[1].muted, true);
  for (const key of Object.keys(DEFAULT_AUDIO_SETTINGS)) {
    assert(key in saved[2], `restored object has ${key}`);
    assertEqual(saved[2][key], DEFAULT_AUDIO_SETTINGS[key], `${key} restored`);
  }
  manager.dispose();
});

/* --------------------------------------------------------- game direction */

const HAND = (over = {}) => ({
  id: 1,
  cards: [{ id: 'p1' }, { id: 'p2' }],
  status: 'STOOD',
  result: null,
  ...over,
});

const SNAP = (over = {}) => ({
  roundState: 'PLAYER_TURN',
  hands: [HAND()],
  dealer: { cards: [{ id: 'd1' }], holeCardHidden: false, evaluation: { isBust: false } },
  roundSummary: null,
  ...over,
});

test('resultSoundKey covers the full outcome hierarchy', () => {
  assertEqual(resultSoundKey(SNAP({
    roundSummary: { netCents: 750 },
    hands: [HAND({ result: 'BLACKJACK_WIN', status: 'BLACKJACK' })],
  })), 'resultBlackjack');
  assertEqual(resultSoundKey(SNAP({
    roundSummary: { netCents: 500 },
    hands: [HAND({ result: 'WIN' })],
  })), 'resultWin');
  assertEqual(resultSoundKey(SNAP({
    roundSummary: { netCents: 0 },
    hands: [HAND({ result: 'PUSH' })],
  })), 'resultPush');
  assertEqual(resultSoundKey(SNAP({
    roundSummary: { netCents: -500 },
    hands: [HAND({ result: 'LOSS' })],
  })), 'resultLoss');
  assertEqual(resultSoundKey(SNAP({
    roundSummary: { netCents: -500 },
    hands: [HAND({ result: 'LOSS', status: 'BUST' })],
  })), 'bust', 'an all-bust loss is voiced by the bust sound');
});

function recordingManager() {
  return {
    calls: [],
    playSound(key, options = {}) {
      this.calls.push({ key, ...options });
      return true;
    },
  };
}

test('exactly one result sound per resolved round', () => {
  const fake = recordingManager();
  const audio = createGameAudio(fake);
  audio.roundStarted();
  const playing = SNAP();
  const complete = SNAP({
    roundState: 'ROUND_COMPLETE',
    hands: [HAND({ result: 'WIN' })],
    dealer: {
      cards: [{ id: 'd1' }, { id: 'd2' }],
      holeCardHidden: false,
      evaluation: { isBust: false },
    },
    roundSummary: { netCents: 500 },
  });
  audio.roundTransition(playing, complete);
  // A re-render or stray duplicate call must not repeat the result.
  audio.roundTransition(complete, complete);
  audio.roundTransition(playing, complete);
  const results = fake.calls.filter((c) => c.key.startsWith('result'));
  assertEqual(results.length, 1, 'one result sound');
  assertEqual(results[0].key, 'resultWin');
});

test('each newly dealt card gets one staggered sound; no re-sounding', () => {
  const fake = recordingManager();
  const audio = createGameAudio(fake);
  audio.roundStarted();
  const waiting = SNAP({ roundState: 'WAITING_FOR_BET', hands: [], dealer: { cards: [], holeCardHidden: false, evaluation: null } });
  const dealt = SNAP();
  audio.roundTransition(waiting, dealt, { baseDelay: 0.2 });
  const deals = fake.calls.filter((c) => c.key === 'cardDeal');
  assertEqual(deals.length, 3, 'two player cards + dealer upcard');
  assert(deals[0].delay < deals[1].delay && deals[1].delay < deals[2].delay, 'staggered');
  fake.calls.length = 0;
  audio.roundTransition(dealt, dealt);
  assertEqual(fake.calls.filter((c) => c.key === 'cardDeal').length, 0, 'no repeats');
});

test('hole-card reveal is voiced as a reveal, not a deal', () => {
  const fake = recordingManager();
  const audio = createGameAudio(fake);
  audio.roundStarted();
  const hidden = SNAP({
    dealer: { cards: [{ id: 'd1' }, { hidden: true }], holeCardHidden: true, evaluation: {} },
  });
  audio.roundTransition(SNAP({ roundState: 'WAITING_FOR_BET', hands: [], dealer: { cards: [], holeCardHidden: false } }), hidden);
  fake.calls.length = 0;
  const revealed = SNAP({
    roundState: 'ROUND_COMPLETE',
    hands: [HAND({ result: 'LOSS' })],
    dealer: { cards: [{ id: 'd1' }, { id: 'd2' }], holeCardHidden: false, evaluation: { isBust: false } },
    roundSummary: { netCents: -500 },
  });
  audio.roundTransition(hidden, revealed);
  assertEqual(fake.calls.filter((c) => c.key === 'cardReveal').length, 1, 'one reveal');
  assertEqual(fake.calls.filter((c) => c.key === 'cardDeal').length, 0, 'not a deal sound');
});

test('a mid-round bust gets its thud; a round-ending bust defers to the result', () => {
  const fake = recordingManager();
  const audio = createGameAudio(fake);
  audio.roundStarted();
  const twoHands = SNAP({
    hands: [HAND(), HAND({ id: 2, status: 'ACTIVE' })],
  });
  const oneBusted = SNAP({
    hands: [HAND({ status: 'BUST', cards: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] }), HAND({ id: 2, status: 'ACTIVE' })],
  });
  audio.roundTransition(twoHands, oneBusted);
  assertEqual(fake.calls.filter((c) => c.key === 'bust').length, 1, 'mid-round thud');
});

test('music track constant points into the manifest base', () => {
  assert(MUSIC_TRACK.endsWith('.mp3'));
});
