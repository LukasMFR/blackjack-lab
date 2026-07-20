/**
 * Camera-based QR scanning for the pairing wizard.
 *
 * Uses the browser's native BarcodeDetector where available (Chrome,
 * Edge, Android). Where it is missing (notably Safari) or when camera
 * permission is denied, the pairing wizard always offers the manual
 * copy/paste fallback — scanning is a convenience, never a requirement.
 */

/** @returns {Promise<boolean>} whether camera QR scanning can work here */
export async function qrScanningSupported() {
  if (typeof globalThis.BarcodeDetector !== 'function') return false;
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) return false;
  try {
    const formats = await globalThis.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

/**
 * Start scanning with the rear camera into the given <video> element.
 *
 * @param {HTMLVideoElement} video - element to attach the stream to
 * @param {(text: string) => void} onResult - called once per detected code
 * @returns {Promise<{stop: () => void}>} rejects if the camera is
 *   unavailable or permission is denied
 */
export async function startQrScanner(video, onResult) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  let running = true;
  let lastValue = null;

  const tick = async () => {
    if (!running) return;
    try {
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue;
      if (value && value !== lastValue) {
        lastValue = value;
        onResult(value);
      }
    } catch { /* detector hiccup on a blurry frame: keep scanning */ }
    if (running) setTimeout(tick, 250);
  };
  tick();

  return {
    stop() {
      running = false;
      video.pause();
      video.srcObject = null;
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
