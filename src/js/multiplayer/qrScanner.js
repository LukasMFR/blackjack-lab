/**
 * Cross-browser camera QR scanning for the pairing wizard.
 *
 * qr-scanner uses BarcodeDetector when the implementation is trustworthy and
 * falls back to its Web Worker decoder everywhere else, including Safari.
 * Camera support is intentionally checked independently of BarcodeDetector.
 */

import QrScanner from '../vendor/qr-scanner/qr-scanner.min.js';

export const QR_SCANNER_ERRORS = Object.freeze({
  INSECURE_CONTEXT: 'INSECURE_CONTEXT',
  UNSUPPORTED_BROWSER: 'UNSUPPORTED_BROWSER',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  DECODING_FAILED: 'DECODING_FAILED',
});

export class QrScannerError extends Error {
  constructor(code, cause = null) {
    super(code);
    this.name = 'QrScannerError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
}

/**
 * Return the reason camera scanning cannot start, without requesting access.
 * @param {typeof globalThis} env
 */
export function getQrScanningSupport(env = globalThis) {
  const protocol = env.location?.protocol;
  const hostname = env.location?.hostname;
  const explicitlyInsecure = env.isSecureContext === false;
  const insecureHttp = protocol === 'http:' && !isLoopbackHost(hostname);

  if (explicitlyInsecure || insecureHttp) {
    return { supported: false, code: QR_SCANNER_ERRORS.INSECURE_CONTEXT };
  }
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== 'function') {
    return { supported: false, code: QR_SCANNER_ERRORS.UNSUPPORTED_BROWSER };
  }
  return { supported: true, code: null };
}

/** @returns {Promise<boolean>} whether this context exposes camera access. */
export async function qrScanningSupported(env = globalThis) {
  return getQrScanningSupport(env).supported;
}

/** Map browser-specific media errors to stable UI error codes. */
export function classifyCameraError(error) {
  if (error instanceof QrScannerError) return error.code;

  const name = error?.name ?? '';
  const message = String(error?.message ?? error ?? '');
  if (name === 'NotAllowedError' || name === 'SecurityError'
    || /permission|not allowed|denied/i.test(message)) {
    return QR_SCANNER_ERRORS.PERMISSION_DENIED;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError'
    || name === 'NotReadableError' || name === 'TrackStartError'
    || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError'
    || name === 'AbortError' || /camera not found|no camera/i.test(message)) {
    return QR_SCANNER_ERRORS.CAMERA_UNAVAILABLE;
  }
  return QR_SCANNER_ERRORS.CAMERA_UNAVAILABLE;
}

function canRetryWithoutFacingMode(error) {
  return ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError',
    'ConstraintNotSatisfiedError', 'TypeError'].includes(error?.name);
}

/**
 * Prefer a rear camera, then retry with any video input if that constraint is
 * not available (common on desktop Safari and single-camera devices).
 */
export async function requestCameraStream(mediaDevices) {
  try {
    return await mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (error) {
    if (!canRetryWithoutFacingMode(error)) throw error;
    return mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

/**
 * Apply the attributes required for reliable inline playback on iOS.
 *
 * `playsinline` and `muted` are what let a camera preview run inline on iOS.
 * Autoplay is deliberately turned off: qr-scanner only starts decoding from the
 * `play` event, so playback must be started by `scanner.start()` and not by the
 * browser the moment the stream is attached. See startQrScanner().
 */
export function configureScannerVideo(video) {
  video.playsInline = true;
  video.muted = true;
  video.autoplay = false;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.removeAttribute?.('autoplay');
  if ('disablePictureInPicture' in video) video.disablePictureInPicture = true;
}

/** Longest canvas edge used for decoding; caps CPU on high-resolution cameras. */
const MAX_DECODE_EDGE = 1280;

/**
 * Scan the whole camera frame instead of qr-scanner's centred two-thirds square.
 *
 * The preview is cropped with `object-fit: cover`, so the default centred region
 * does not match the area the user sees while framing the code. Pairing payloads
 * also produce dense QR symbols that need most of the sensor resolution, so the
 * frame is only downscaled once it exceeds MAX_DECODE_EDGE.
 *
 * @param {HTMLVideoElement} video
 */
export function fullFrameScanRegion(video) {
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  const longestEdge = Math.max(width, height);
  const scale = longestEdge > MAX_DECODE_EDGE ? MAX_DECODE_EDGE / longestEdge : 1;
  return {
    x: 0,
    y: 0,
    width,
    height,
    downScaledWidth: Math.round(width * scale),
    downScaledHeight: Math.round(height * scale),
  };
}

function stopVideoResources(video, stream, scanner) {
  // destroy() closes qr-scanner's worker and listeners. Tracks are also
  // stopped directly so Safari releases the camera immediately.
  try { scanner?.destroy(); } catch { /* cleanup remains best-effort */ }
  const ownsVideo = !stream || video.srcObject === stream;
  if (ownsVideo) {
    try { video.pause(); } catch { /* a test double or detached video */ }
  }

  const streams = new Set([stream, ownsVideo ? video.srcObject : null].filter(Boolean));
  for (const activeStream of streams) {
    for (const track of activeStream.getTracks?.() ?? []) track.stop();
  }
  if (ownsVideo) video.srcObject = null;
}

function isEmptyFrameResult(error, Scanner) {
  return error === Scanner.NO_QR_CODE_FOUND
    || String(error?.message ?? error) === Scanner.NO_QR_CODE_FOUND;
}

/**
 * Start scanning into the supplied video element.
 *
 * Ordering is load-bearing. qr-scanner drives its whole decode loop from the
 * `play` listener it registers in its constructor, and `start()` skips playback
 * entirely when a stream is already attached. So the scanner must be built
 * before the stream is attached, and the element must still be paused when
 * `start()` runs — otherwise the preview appears but no frame is ever decoded.
 *
 * @param {HTMLVideoElement} video
 * @param {(text: string) => void} onResult
 * @param {object} options
 * @param {(error: QrScannerError) => void} [options.onDecodeError]
 * @param {AbortSignal} [options.signal]
 * @param {typeof globalThis} [options.env]
 * @param {typeof QrScanner} [options.Scanner]
 * @returns {Promise<{stop: () => void}>}
 */
export async function startQrScanner(video, onResult, {
  onDecodeError = () => {},
  signal = null,
  env = globalThis,
  Scanner = QrScanner,
} = {}) {
  const support = getQrScanningSupport(env);
  if (!support.supported) throw new QrScannerError(support.code);

  configureScannerVideo(video);
  let stream = null;
  let scanner = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', stop);
    stopVideoResources(video, stream, scanner);
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();

  try {
    stream = await requestCameraStream(env.navigator.mediaDevices);
    if (stopped) {
      stopVideoResources(video, stream, scanner);
      return { stop };
    }

    try {
      scanner = new Scanner(video, (result) => {
        if (stopped) return;
        const text = typeof result === 'string' ? result : result?.data;
        if (typeof text === 'string' && text) onResult(text);
      }, {
        preferredCamera: 'environment',
        maxScansPerSecond: 12,
        returnDetailedScanResult: true,
        calculateScanRegion: fullFrameScanRegion,
        onDecodeError(error) {
          if (!stopped && !isEmptyFrameResult(error, Scanner)) {
            onDecodeError(new QrScannerError(QR_SCANNER_ERRORS.DECODING_FAILED, error));
          }
        },
      });
    } catch (error) {
      throw new QrScannerError(QR_SCANNER_ERRORS.DECODING_FAILED, error);
    }

    // The scanner now owns playback: attach the stream, keep the element
    // paused, and let start() emit the `play` event the decode loop waits for.
    video.srcObject = stream;
    if (video.paused === false) video.pause();
    await scanner.start();
    return { stop };
  } catch (error) {
    stop();
    throw error instanceof QrScannerError
      ? error
      : new QrScannerError(classifyCameraError(error), error);
  }
}
