import { randomId } from './stateSync.js';

/**
 * WebRTC DataChannel plumbing for the local multiplayer mode.
 *
 * Connections are strictly peer-to-peer on the local network: the
 * RTCPeerConnection is configured with NO ICE servers (no STUN, no TURN),
 * so only host/mDNS candidates are gathered and no third-party service is
 * ever contacted. Signalling is manual (signalling.js + QR / copy-paste).
 *
 * Each PeerLink wraps one RTCPeerConnection + one reliable ordered
 * DataChannel and exposes the small transport contract the session
 * classes expect: `{ id, send(frame), close() }` plus `onMessage` /
 * `onClose` assigned by the session.
 */

const RTC_CONFIG = { iceServers: [] };
const ICE_GATHERING_TIMEOUT_MS = 4000;

/** @returns {boolean} */
export function isWebRtcSupported() {
  return typeof globalThis.RTCPeerConnection === 'function';
}

/**
 * Wait until ICE candidate gathering finishes (or times out — with
 * host-only candidates gathering is normally near-instant).
 * @param {RTCPeerConnection} pc
 * @returns {Promise<void>}
 */
function waitForIceComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ICE_GATHERING_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/** One peer-to-peer link (either side). */
export class PeerLink {
  /**
   * @param {RTCPeerConnection} pc
   * @param {{onOpen?: Function, onClose?: Function}} [callbacks]
   */
  constructor(pc, { onOpen = null, onClose = null } = {}) {
    this.pc = pc;
    this.channel = null;
    this.closed = false;
    this.disconnectTimer = null;
    this.onOpen = onOpen;
    this.onCloseCallback = onClose;
    this.pendingFrames = [];
    this.transport = {
      id: randomId('link'),
      send: (frame) => this.#send(frame),
      close: () => this.close(),
      onMessage: null,
      onClose: null,
    };
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        this.#handleClosed();
      } else if (pc.connectionState === 'disconnected') {
        // 'disconnected' is transient: ICE may recover on its own. Only a
        // sustained outage counts as a closed link.
        this.disconnectTimer ??= setTimeout(() => this.#handleClosed(), 7000);
      } else if (pc.connectionState === 'connected' && this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
    });
  }

  /** @param {RTCDataChannel} channel */
  attachChannel(channel) {
    this.channel = channel;
    channel.onopen = () => {
      for (const frame of this.pendingFrames.splice(0)) channel.send(frame);
      this.onOpen?.();
    };
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') this.transport.onMessage?.(event.data);
    };
    channel.onclose = () => this.#handleClosed();
  }

  #send(frame) {
    if (this.closed) throw new Error('Link is closed');
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(frame);
    } else {
      // The channel opens moments after the answer is applied; queue
      // rather than drop frames sent in that window.
      this.pendingFrames.push(frame);
    }
  }

  #handleClosed() {
    if (this.closed) return;
    this.closed = true;
    this.transport.onClose?.();
    this.onCloseCallback?.();
  }

  /** Tear the link down (idempotent). */
  close() {
    if (!this.closed) {
      this.closed = true;
      this.transport.onClose?.();
      this.onCloseCallback?.();
    }
    try {
      this.channel?.close();
    } catch { /* already closed */ }
    try {
      this.pc.close();
    } catch { /* already closed */ }
  }
}

/**
 * Host side: create a link and produce the offer to hand to one joining
 * player. One link per player.
 * @param {{onOpen?: Function, onClose?: Function}} [callbacks]
 * @returns {Promise<{link: PeerLink, description: {type: string, sdp: string}}>}
 */
export async function createHostLink(callbacks = {}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const link = new PeerLink(pc, callbacks);
  link.attachChannel(pc.createDataChannel('bjlab', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIceComplete(pc);
  const { type, sdp } = pc.localDescription;
  return { link, description: { type, sdp } };
}

/**
 * Apply the answer a joining player sent back.
 * @param {PeerLink} link
 * @param {{type: string, sdp: string}} description
 */
export async function acceptAnswer(link, description) {
  await link.pc.setRemoteDescription(description);
}

/**
 * Client side: consume a host offer and produce the answer to send back.
 * @param {{type: string, sdp: string}} offerDescription
 * @param {{onOpen?: Function, onClose?: Function}} [callbacks]
 * @returns {Promise<{link: PeerLink, description: {type: string, sdp: string}}>}
 */
export async function createClientLink(offerDescription, callbacks = {}) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const link = new PeerLink(pc, callbacks);
  pc.addEventListener('datachannel', (event) => link.attachChannel(event.channel));
  await pc.setRemoteDescription(offerDescription);
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForIceComplete(pc);
  const { type, sdp } = pc.localDescription;
  return { link, description: { type, sdp } };
}
