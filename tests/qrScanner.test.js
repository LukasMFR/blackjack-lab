import { test, assert, assertEqual } from './runner.js';
import {
  classifyCameraError,
  configureScannerVideo,
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

function fakeVideo() {
  return {
    attributes: new Map(),
    autoplay: false,
    muted: false,
    playsInline: false,
    srcObject: null,
    playCount: 0,
    pauseCount: 0,
    setAttribute(name, value) { this.attributes.set(name, value); },
    async play() { this.playCount += 1; },
    pause() { this.pauseCount += 1; },
  };
}

class FakeScanner {
  static NO_QR_CODE_FOUND = 'No QR code found';
  static instances = [];

  constructor(video, onResult, options) {
    this.video = video;
    this.onResult = onResult;
    this.options = options;
    this.destroyed = false;
    FakeScanner.instances.push(this);
  }

  async start() { this.started = true; }
  destroy() { this.destroyed = true; }
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

  assert(video.playsInline && video.muted && video.autoplay, 'video properties enabled');
  assert(video.attributes.has('playsinline'), 'playsinline attribute');
  assert(video.attributes.has('webkit-playsinline'), 'legacy iOS inline attribute');
  assertEqual(video.srcObject, stream, 'stream attached');
  assertEqual(video.playCount, 1, 'video started');

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
  configureScannerVideo(video);
  assert(video.muted && video.autoplay && video.playsInline, 'autoplay-safe flags');
});
