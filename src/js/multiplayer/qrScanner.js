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

/** Apply the attributes required for reliable inline autoplay on iOS. */
export function configureScannerVideo(video) {
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  if ('disablePictureInPicture' in video) video.disablePictureInPicture = true;
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
  let cameraReady = false;
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
    video.srcObject = stream;
    await video.play();
    cameraReady = true;

    scanner = new Scanner(video, (result) => {
      const text = typeof result === 'string' ? result : result?.data;
      if (typeof text === 'string' && text) onResult(text);
    }, {
      preferredCamera: 'environment',
      maxScansPerSecond: 12,
      returnDetailedScanResult: true,
      onDecodeError(error) {
        if (!isEmptyFrameResult(error, Scanner)) {
          onDecodeError(new QrScannerError(QR_SCANNER_ERRORS.DECODING_FAILED, error));
        }
      },
    });
    await scanner.start();
    return { stop };
  } catch (error) {
    stop();
    throw error instanceof QrScannerError
      ? error
      : new QrScannerError(
        cameraReady ? QR_SCANNER_ERRORS.DECODING_FAILED : classifyCameraError(error),
        error,
      );
  }
}
