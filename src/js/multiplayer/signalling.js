/**
 * Manual WebRTC signalling payloads.
 *
 * There is no signalling server anywhere: an offer or answer travels
 * between devices as text — a QR code, copy/paste, or the native Share
 * sheet. This module turns a session description into a compact,
 * versioned, self-describing string and back, validating everything on
 * the way in.
 *
 * Format:  BJL1C:<base64url of deflate-raw compressed JSON>
 *          BJL1P:<base64url of plain JSON>          (no CompressionStream)
 *
 * The JSON body: { k: 'offer'|'answer', sid, pid, name?, sdp: {type, sdp},
 * at: <epoch ms> }. Payloads expire after SIGNAL_TTL_MS so a stale QR
 * code fails with a clear error instead of a hanging connection.
 */

export const SIGNAL_KINDS = Object.freeze({ OFFER: 'offer', ANSWER: 'answer' });

/** Pairing payloads older than this are refused as stale. */
export const SIGNAL_TTL_MS = 10 * 60 * 1000;

const PREFIX_COMPRESSED = 'BJL1C:';
const PREFIX_PLAIN = 'BJL1P:';
/** Any other BJL<n> prefix is a payload from a newer app version. */
const PREFIX_PATTERN = /^BJL(\d+)[CP]:/;

export const SIGNAL_ERRORS = Object.freeze({
  BAD_FORMAT: 'BAD_FORMAT',
  INCOMPATIBLE_VERSION: 'INCOMPATIBLE_VERSION',
  WRONG_KIND: 'WRONG_KIND',
  STALE: 'STALE',
});

/* ------------------------------------------------------------- base64url */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += B64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += B64_ALPHABET[c & 0x3f];
  }
  return out;
}

function base64UrlToBytes(text) {
  const values = new Map([...B64_ALPHABET].map((ch, i) => [ch, i]));
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const value = values.get(ch);
    if (value === undefined) throw new Error(`Invalid base64url character: ${ch}`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/* ---------------------------------------------------------- compression */

function compressionSupported() {
  return typeof globalThis.CompressionStream === 'function'
    && typeof globalThis.DecompressionStream === 'function'
    && typeof globalThis.Response === 'function';
}

async function pipeThrough(bytes, stream) {
  const source = new Response(bytes).body.pipeThrough(stream);
  const buffer = await new Response(source).arrayBuffer();
  return new Uint8Array(buffer);
}

/* -------------------------------------------------------------- encoding */

/**
 * Encode a signalling payload for transfer by QR, copy/paste or Share.
 * @param {object} signal
 * @param {string} signal.kind - SIGNAL_KINDS value
 * @param {string} signal.sessionId - host session id
 * @param {string} signal.peerId - the pairing slot / peer this belongs to
 * @param {{type: string, sdp: string}} signal.description - RTC description
 * @param {string} [signal.name] - display name (answers)
 * @param {object} [options]
 * @param {number} [options.now] - injectable clock for tests
 * @returns {Promise<string>}
 */
export async function encodeSignal(
  { kind, sessionId, peerId, description, name },
  { now = Date.now() } = {},
) {
  if (!Object.values(SIGNAL_KINDS).includes(kind)) throw new Error(`Invalid kind: ${kind}`);
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Missing sessionId');
  if (typeof peerId !== 'string' || peerId.length === 0) throw new Error('Missing peerId');
  if (!description || typeof description.type !== 'string' || typeof description.sdp !== 'string') {
    throw new Error('Missing RTC description');
  }
  const body = {
    k: kind,
    sid: sessionId,
    pid: peerId,
    sdp: { type: description.type, sdp: description.sdp },
    at: now,
    ...(name ? { name } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(body));
  if (compressionSupported()) {
    const deflated = await pipeThrough(json, new CompressionStream('deflate-raw'));
    return PREFIX_COMPRESSED + bytesToBase64Url(deflated);
  }
  return PREFIX_PLAIN + bytesToBase64Url(json);
}

/**
 * Decode and validate a signalling payload.
 * @param {string} text - the pasted / scanned payload
 * @param {object} [options]
 * @param {string} [options.expectKind] - SIGNAL_KINDS value to require
 * @param {number} [options.now] - injectable clock for tests
 * @returns {Promise<{ok: true, signal: object} |
 *   {ok: false, code: string, detail: string}>}
 */
export async function decodeSignal(text, { expectKind = null, now = Date.now() } = {}) {
  const fail = (code, detail) => ({ ok: false, code, detail });
  if (typeof text !== 'string') return fail(SIGNAL_ERRORS.BAD_FORMAT, 'not a string');
  const trimmed = text.trim();
  const versionMatch = PREFIX_PATTERN.exec(trimmed);
  if (!versionMatch) return fail(SIGNAL_ERRORS.BAD_FORMAT, 'not a Blackjack Lab pairing code');
  if (versionMatch[1] !== '1') {
    return fail(SIGNAL_ERRORS.INCOMPATIBLE_VERSION, `pairing format v${versionMatch[1]}`);
  }
  const compressed = trimmed.startsWith(PREFIX_COMPRESSED);
  if (!compressed && !trimmed.startsWith(PREFIX_PLAIN)) {
    return fail(SIGNAL_ERRORS.BAD_FORMAT, 'unknown payload marker');
  }
  let body;
  try {
    let bytes = base64UrlToBytes(trimmed.slice(PREFIX_COMPRESSED.length));
    if (compressed) {
      if (!compressionSupported()) {
        return fail(SIGNAL_ERRORS.BAD_FORMAT, 'compressed payload not supported by this browser');
      }
      bytes = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
    }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail(SIGNAL_ERRORS.BAD_FORMAT, 'corrupted payload');
  }
  if (typeof body !== 'object' || body === null) {
    return fail(SIGNAL_ERRORS.BAD_FORMAT, 'payload is not an object');
  }
  if (!Object.values(SIGNAL_KINDS).includes(body.k)) {
    return fail(SIGNAL_ERRORS.BAD_FORMAT, 'unknown payload kind');
  }
  if (typeof body.sid !== 'string' || body.sid.length === 0
    || typeof body.pid !== 'string' || body.pid.length === 0
    || !body.sdp || typeof body.sdp.type !== 'string' || typeof body.sdp.sdp !== 'string'
    || !Number.isSafeInteger(body.at)) {
    return fail(SIGNAL_ERRORS.BAD_FORMAT, 'incomplete payload');
  }
  if (expectKind && body.k !== expectKind) {
    return fail(SIGNAL_ERRORS.WRONG_KIND, `expected ${expectKind}, got ${body.k}`);
  }
  // Devices' clocks may disagree; only clearly old payloads are refused.
  if (now - body.at > SIGNAL_TTL_MS) {
    return fail(SIGNAL_ERRORS.STALE, 'pairing code expired');
  }
  return {
    ok: true,
    signal: {
      kind: body.k,
      sessionId: body.sid,
      peerId: body.pid,
      description: { type: body.sdp.type, sdp: body.sdp.sdp },
      createdAt: body.at,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
    },
  };
}
