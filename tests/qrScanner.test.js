import { test, assert, assertEqual } from './runner.js';
import {
  classifyCameraError,
  configureScannerVideo,
  fullFrameScanRegion,
  getQrScanningSupport,
  QR_SCANNER_ERRORS,
  qrScanningSupported,
  requestCameraStream,
  startQrScanner,
} from '../src/js/multiplayer/qrScanner.js';

function namedError(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

/**
 * A video element faithful to the parts qr-scanner depends on: `play` only
 * fires on a paused -> playing transition, and an autoplaying element starts on
 * its own as soon as a stream is attached.
 */
function fakeVideo() {
  return {
    attributes: new Map(),
    listeners: new Map(),
    autoplay: false,
    muted: false,
    playsInline: false,
    paused: true,
    playCount: 0,
    pauseCount: 0,
    videoWidth: 1280,
    videoHeight: 720,
    _srcObject: null,
    get srcObject() { return this._srcObject; },
    set srcObject(value) {
      this._srcObject = value;
      if (value && this.autoplay) this.play();
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); },
    dispatch(type) {
      for (const handler of [...(this.listeners.get(type) ?? [])]) handler();
    },
    async play() {
      this.playCount += 1;
      if (!this.paused) return; // replaying an active element emits no event
      this.paused = false;
      this.dispatch('play');
    },
    pause() {
      this.pauseCount += 1;
      this.paused = true;
    },
  };
}

/**
 * Mirrors qr-scanner's real lifecycle: the decode loop is only ever entered
 * from the `play` listener registered in the constructor, and start() skips
 * playback when a stream is already attached.
 */
class FakeScanner {
  static NO_QR_CODE_FOUND = 'No QR code found';
  static instances = [];

  constructor(video, onResult, options) {
    this.video = video;
    this.onResult = onResult;
    this.options = options;
    this.destroyed = false;
    this.scanning = false;
    this.active = false;
    this._onPlay = () => this._scanFrame();
    video.addEventListener('play', this._onPlay);
    FakeScanner.instances.push(this);
  }

  _scanFrame() {
    if (!this.active || this.video.paused) return;
    this.scanning = true;
  }

  async start() {
    this.started = true;
    this.active = true;
    if (this.video.srcObject) await this.video.play();
  }

  destroy() {
    this.destroyed = true;
    this.active = false;
    this.scanning = false;
    this.video.removeEventListener('play', this._onPlay);
  }
}

test('qr scanner: camera support does not depend on BarcodeDetector', async () => {
  const env = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia() {} } },
  };
  assertEqual(getQrScanningSupport(env).supported, true, 'camera API is enough');
  assertEqual(await qrScanningSupported(env), true, 'legacy boolean helper');
});

test('qr scanner: insecure HTTP and unsupported browsers are distinct', () => {
  const insecure = getQrScanningSupport({
    isSecureContext: false,
    location: { protocol: 'http:', hostname: '192.168.1.8' },
    navigator: { mediaDevices: { getUserMedia() {} } },
  });
  assertEqual(insecure.code, QR_SCANNER_ERRORS.INSECURE_CONTEXT, 'HTTP error');

  const unsupported = getQrScanningSupport({
    isSecureContext: true,
    navigator: {},
  });
  assertEqual(unsupported.code, QR_SCANNER_ERRORS.UNSUPPORTED_BROWSER, 'API error');

  const localhost = getQrScanningSupport({
    location: { protocol: 'http:', hostname: 'localhost' },
    navigator: { mediaDevices: { getUserMedia() {} } },
  });
  assertEqual(localhost.supported, true, 'localhost stays usable');
});

test('qr scanner: permission and unavailable-camera errors are distinct', () => {
  assertEqual(
    classifyCameraError(namedError('NotAllowedError')),
    QR_SCANNER_ERRORS.PERMISSION_DENIED,
    'permission denied',
  );
  assertEqual(
    classifyCameraError(namedError('NotFoundError')),
    QR_SCANNER_ERRORS.CAMERA_UNAVAILABLE,
    'no camera',
  );
  assertEqual(
    classifyCameraError(namedError('NotReadableError')),
    QR_SCANNER_ERRORS.CAMERA_UNAVAILABLE,
    'busy camera',
  );
});

test('qr scanner: rear camera is preferred with an any-camera fallback', async () => {
  const stream = fakeStream();
  const calls = [];
  const mediaDevices = {
    async getUserMedia(constraints) {
      calls.push(constraints);
      if (calls.length === 1) throw namedError('OverconstrainedError');
      return stream;
    },
  };
  assertEqual(await requestCameraStream(mediaDevices), stream, 'fallback stream');
  assertEqual(calls[0].video.facingMode.exact, 'environment', 'rear camera first');
  assertEqual(calls[1].video, true, 'any camera second');

  let deniedCalls = 0;
  let deniedError = null;
  try {
    await requestCameraStream({
      async getUserMedia() {
        deniedCalls += 1;
        throw namedError('NotAllowedError');
      },
    });
  } catch (error) {
    deniedError = error;
  }
  assertEqual(deniedError?.name, 'NotAllowedError', 'original denial preserved');
  assertEqual(deniedCalls, 1, 'permission denial is not retried');
});

test('qr scanner: iOS video flags, decoder callback, and cleanup are reliable', async () => {
  FakeScanner.instances = [];
  const video = fakeVideo();
  const stream = fakeStream();
  const results = [];
  const decodeErrors = [];
  const scannerHandle = await startQrScanner(video, (value) => results.push(value), {
    env: {
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: async () => stream } },
    },
    Scanner: FakeScanner,
    onDecodeError: (error) => decodeErrors.push(error.code),
  });

  assert(video.playsInline && video.muted, 'inline playback properties enabled');
  assert(video.attributes.has('playsinline'), 'playsinline attribute');
  assert(video.attributes.has('webkit-playsinline'), 'legacy iOS inline attribute');
  assertEqual(video.srcObject, stream, 'stream attached');
  assertEqual(video.paused, false, 'video started');

  const scanner = FakeScanner.instances[0];
  assertEqual(scanner.options.preferredCamera, 'environment', 'scanner preference');
  scanner.onResult({ data: 'BJL1.example' });
  assertEqual(results[0], 'BJL1.example', 'detailed result unwrapped');
  scanner.options.onDecodeError(FakeScanner.NO_QR_CODE_FOUND);
  assertEqual(decodeErrors.length, 0, 'empty frames are normal');
  scanner.options.onDecodeError(new Error('worker failed'));
  assertEqual(decodeErrors[0], QR_SCANNER_ERRORS.DECODING_FAILED, 'decoder failure');

  scannerHandle.stop();
  scannerHandle.stop();
  assertEqual(scanner.destroyed, true, 'decoder destroyed');
  assertEqual(stream.track.stopped, true, 'camera track stopped');
  assertEqual(video.srcObject, null, 'stream detached');
});

test('qr scanner: closing during permission prompt releases the eventual stream', async () => {
  let resolvePermission;
  const pendingPermission = new Promise((resolve) => { resolvePermission = resolve; });
  const stream = fakeStream();
  const video = fakeVideo();
  const controller = new AbortController();
  const starting = startQrScanner(video, () => {}, {
    signal: controller.signal,
    env: {
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: () => pendingPermission } },
    },
    Scanner: FakeScanner,
  });
  controller.abort();
  resolvePermission(stream);
  const scannerHandle = await starting;
  scannerHandle.stop();

  assertEqual(stream.track.stopped, true, 'late stream stopped');
  assertEqual(video.playCount, 0, 'aborted scanner never plays video');
  assertEqual(video.srcObject, null, 'aborted scanner leaves no stream');
});

test('qr scanner: configureScannerVideo is safe to call before permission', () => {
  const video = fakeVideo();
  video.autoplay = true;
  video.setAttribute('autoplay', '');
  configureScannerVideo(video);
  assert(video.muted && video.playsInline, 'inline-playback flags');
  assertEqual(video.autoplay, false, 'autoplay disabled so the scanner owns playback');
  assertEqual(video.attributes.has('autoplay'), false, 'autoplay attribute removed');
});

test('qr scanner: decoding actually starts, even on an autoplaying element', async () => {
  // Regression: the stream used to be attached and played before the scanner
  // existed, so qr-scanner's constructor missed the one `play` event its decode
  // loop hangs on. The preview ran but no frame was ever decoded.
  for (const markupAutoplay of [false, true]) {
    FakeScanner.instances = [];
    const video = fakeVideo();
    video.autoplay = markupAutoplay;
    if (markupAutoplay) video.setAttribute('autoplay', '');
    const stream = fakeStream();
    const results = [];

    await startQrScanner(video, (value) => results.push(value), {
      env: {
        isSecureContext: true,
        navigator: { mediaDevices: { getUserMedia: async () => stream } },
      },
      Scanner: FakeScanner,
    });

    const scanner = FakeScanner.instances[0];
    assertEqual(video.paused, false, `preview running (autoplay: ${markupAutoplay})`);
    assertEqual(scanner.scanning, true, `decode loop running (autoplay: ${markupAutoplay})`);

    scanner.onResult({ data: 'BJL1C:payload' });
    assertEqual(results[0], 'BJL1C:payload', 'decoded payload delivered');
  }
});

test('qr scanner: the scanner is built before the stream is attached', async () => {
  FakeScanner.instances = [];
  const order = [];
  const video = fakeVideo();
  Object.defineProperty(video, 'srcObject', {
    get() { return this._srcObject; },
    set(value) { if (value) order.push('srcObject'); this._srcObject = value; },
  });
  const stream = fakeStream();

  class OrderedScanner extends FakeScanner {
    constructor(...args) {
      order.push('construct');
      super(...args);
    }

    async start() {
      order.push('start');
      await super.start();
    }
  }

  await startQrScanner(video, () => {}, {
    env: {
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: async () => stream } },
    },
    Scanner: OrderedScanner,
  });

  assertEqual(order.join(' > '), 'construct > srcObject > start', 'setup order');
});

test('qr scanner: results arriving after stop are dropped', async () => {
  FakeScanner.instances = [];
  const video = fakeVideo();
  const stream = fakeStream();
  const results = [];
  const decodeErrors = [];

  const handle = await startQrScanner(video, (value) => results.push(value), {
    env: {
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: async () => stream } },
    },
    Scanner: FakeScanner,
    onDecodeError: (error) => decodeErrors.push(error.code),
  });
  const scanner = FakeScanner.instances[0];
  handle.stop();

  // An in-flight frame can resolve after the scanner was torn down.
  scanner.onResult({ data: 'BJL1C:late' });
  scanner.options.onDecodeError(new Error('worker closed'));
  assertEqual(results.length, 0, 'late result ignored');
  assertEqual(decodeErrors.length, 0, 'teardown noise is not shown to the user');
});

test('qr scanner: the whole camera frame is scanned', () => {
  const region = fullFrameScanRegion({ videoWidth: 1280, videoHeight: 720 });
  assertEqual(region.x, 0, 'no horizontal crop');
  assertEqual(region.y, 0, 'no vertical crop');
  assertEqual(region.width, 1280, 'full frame width');
  assertEqual(region.height, 720, 'full frame height');
  assertEqual(region.downScaledWidth, 1280, '720p is scanned at native resolution');
  assertEqual(region.downScaledHeight, 720, 'aspect ratio preserved');

  const large = fullFrameScanRegion({ videoWidth: 3840, videoHeight: 2160 });
  assertEqual(large.downScaledWidth, 1280, 'oversized frames are capped');
  assertEqual(large.downScaledHeight, 720, 'cap preserves the aspect ratio');

  const unready = fullFrameScanRegion({ videoWidth: 0, videoHeight: 0 });
  assertEqual(unready.width, 0, 'metadata-less frames stay empty until loadedmetadata');
});
