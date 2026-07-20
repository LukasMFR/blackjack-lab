/**
 * Procedural casino-room ambience.
 *
 * Instead of shipping a large looped recording, the room is synthesized:
 *  - a continuous, heavily low-passed noise bed ("room presence") with a
 *    very slow level drift so it never reads as static hiss;
 *  - sparse, randomized one-shots (distant chips and cards, borrowed from
 *    the effect library) played far away: low-passed, quiet, panned.
 *
 * Nothing repeats on a fixed grid, there is no speech, and everything
 * sits far below the gameplay effects. The whole layer runs through the
 * ambience channel gain owned by the AudioManager.
 */

const ROOM_TONE_SECONDS = 6;
const ROOM_TONE_LEVEL = 0.16;
const ONESHOT_MIN_GAP_SEC = 6;
const ONESHOT_RANDOM_SPAN_SEC = 14;

/**
 * @param {object} options
 * @param {AudioContext} options.ctx
 * @param {AudioNode} options.output - the ambience channel gain node
 * @param {() => ({buffer: object, startOffset: number}|null)} options.getOneshot
 *   supplier of a random, already-decoded distant sound (may return null)
 * @param {() => number} [options.random]
 * @returns {{start: () => void, stop: (fadeSec?: number) => void, running: boolean}}
 */
export function createAmbienceEngine({ ctx, output, getOneshot, random = Math.random }) {
  let running = false;
  let nodes = null;
  let oneshotTimer = null;

  function makeRoomToneBuffer() {
    const rate = ctx.sampleRate ?? 44100;
    const length = Math.floor(rate * ROOM_TONE_SECONDS);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let brown = 0;
      for (let i = 0; i < length; i += 1) {
        brown += (random() * 2 - 1) * 0.02;
        brown *= 0.998; // leaky integrator keeps it bounded
        data[i] = brown * 3.5;
      }
      // Blend tail into head so the loop point is inaudible.
      const fade = Math.floor(rate * 0.5);
      for (let i = 0; i < fade; i += 1) {
        const w = i / fade;
        data[i] = data[i] * w + data[length - fade + i] * (1 - w);
      }
    }
    return buffer;
  }

  function start() {
    if (running) return;
    running = true;
    try {
      const source = ctx.createBufferSource();
      source.buffer = makeRoomToneBuffer();
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 340;
      const level = ctx.createGain();
      level.gain.value = 0;
      source.connect(filter);
      filter.connect(level);
      level.connect(output);
      source.start(ctx.currentTime);
      // Fade the room in gently.
      level.gain.setTargetAtTime(ROOM_TONE_LEVEL, ctx.currentTime, 1.2);

      // Very slow "air movement" so the bed never feels frozen.
      let lfo = null;
      let lfoGain = null;
      try {
        lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05;
        lfoGain = ctx.createGain();
        lfoGain.gain.value = ROOM_TONE_LEVEL * 0.3;
        lfo.connect(lfoGain);
        lfoGain.connect(level.gain);
        lfo.start(ctx.currentTime);
      } catch {
        lfo = null;
      }
      nodes = { source, filter, level, lfo, lfoGain };
    } catch (error) {
      console.warn('Ambience unavailable', error);
      nodes = null;
    }
    scheduleOneshot();
  }

  function scheduleOneshot() {
    if (!running) return;
    const wait = (ONESHOT_MIN_GAP_SEC + random() * ONESHOT_RANDOM_SPAN_SEC) * 1000;
    oneshotTimer = setTimeout(() => {
      playDistantOneshot();
      scheduleOneshot();
    }, wait);
  }

  function playDistantOneshot() {
    if (!running) return;
    const entry = getOneshot();
    if (!entry) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = entry.buffer;
      if (source.playbackRate) {
        source.playbackRate.value = 0.92 + random() * 0.1; // distant = duller
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700 + random() * 500;
      const level = ctx.createGain();
      level.gain.value = 0.05 + random() * 0.08;
      source.connect(filter);
      let tail = filter;
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = (random() * 2 - 1) * 0.7;
        filter.connect(panner);
        tail = panner;
      }
      tail.connect(level);
      level.connect(output);
      source.start(ctx.currentTime, entry.startOffset);
      source.onended = () => {
        try {
          source.disconnect();
          level.disconnect();
        } catch { /* gone */ }
      };
    } catch { /* a lost distant sound is never an error */ }
  }

  function stop(fadeSec = 0.8) {
    if (!running) return;
    running = false;
    if (oneshotTimer) {
      clearTimeout(oneshotTimer);
      oneshotTimer = null;
    }
    if (nodes) {
      const { source, level, lfo } = nodes;
      const t = ctx.currentTime;
      try {
        level.gain.cancelScheduledValues(t);
        level.gain.setTargetAtTime(0, t, fadeSec / 3);
        source.stop(t + fadeSec + 0.1);
        lfo?.stop(t + fadeSec + 0.1);
      } catch { /* already stopped */ }
      nodes = null;
    }
  }

  return {
    start,
    stop,
    get running() {
      return running;
    },
  };
}
