import { RESULTS, ROUND_STATES } from '../game/constants.js';
import { PROFILE_IDS } from '../config/profiles.js';
import * as storage from './storage.js';

/**
 * Per-profile session persistence: chosen starting bankroll, live bankroll,
 * round history, and session statistics.
 *
 * Every profile keeps an independent record, so switching profiles never mixes
 * their data. All records live under a single storage key, which means a round
 * settlement or a bankroll reset is one write: the stored state is never left
 * half-updated, and it survives a reload immediately.
 *
 * Nothing here touches the DOM or the engine; the store only reads and writes
 * plain data.
 */

export const SESSIONS_KEY = 'sessions';

/** Bumped whenever the stored shape changes; unknown versions are migrated. */
export const SESSIONS_SCHEMA_VERSION = 2;

/** How many finished rounds the history keeps, oldest dropped first. */
export const HISTORY_LIMIT = 30;

/** Guard against a tampered entry describing an absurd number of hands. */
const MAX_RESULTS_PER_ROUND = 16;

const RESULT_VALUES = new Set(Object.values(RESULTS));

const isMoney = (value) => Number.isSafeInteger(value);
const isPositiveMoney = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * A profile that has never been played.
 * @returns {{startingBankrollCents: number|null, bankrollCents: number|null,
 *            roundCount: number, netCents: number, history: object[]}}
 */
export function emptySession() {
  return {
    startingBankrollCents: null,
    bankrollCents: null,
    roundCount: 0,
    netCents: 0,
    history: [],
  };
}

/**
 * Rebuild one history entry from untrusted data.
 * @param {unknown} raw
 * @returns {object|null} null when the entry cannot be trusted
 */
function sanitizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!isPositiveMoney(raw.n) || raw.n === 0) return null;
  if (!isMoney(raw.netCents)) return null;
  if (!Array.isArray(raw.results)) return null;
  const results = raw.results.slice(0, MAX_RESULTS_PER_ROUND);
  if (results.length === 0 || !results.every((result) => RESULT_VALUES.has(result))) return null;
  return {
    n: raw.n,
    netCents: raw.netCents,
    results,
    insurance: raw.insurance === true,
  };
}

/**
 * Rebuild one profile record from untrusted data. Individual bad fields fall
 * back to their defaults rather than discarding an otherwise usable session.
 * @param {unknown} raw
 * @returns {object|null} null when the record is not an object at all
 */
export function sanitizeSession(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const session = emptySession();
  if (isPositiveMoney(raw.startingBankrollCents)) {
    session.startingBankrollCents = raw.startingBankrollCents;
  }
  if (isPositiveMoney(raw.bankrollCents)) session.bankrollCents = raw.bankrollCents;
  if (isPositiveMoney(raw.roundCount)) session.roundCount = raw.roundCount;
  if (isMoney(raw.netCents)) session.netCents = raw.netCents;
  if (Array.isArray(raw.history)) {
    session.history = raw.history
      .map(sanitizeHistoryEntry)
      .filter((entry) => entry !== null)
      .slice(-HISTORY_LIMIT);
  }
  // A round counter below the newest recorded round means the counter was the
  // corrupted field, not the history: trust the rounds we can actually see.
  const newest = session.history.at(-1);
  if (newest && newest.n > session.roundCount) session.roundCount = newest.n;
  return session;
}

/* --------------------------------------------------------------- migration */

/** Pre-v2 layout: one key per profile, bankroll and preference kept apart. */
const legacyBankrollKey = (profileId) => `bankroll.${profileId}`;
const legacyStartingBankrollKey = (profileId) => `startingBankroll.${profileId}`;

/**
 * Fold any pre-v2 keys into the current shape. Called whenever the sessions
 * blob is missing or unreadable, so an interrupted upgrade simply runs again.
 * @returns {Record<string, object>}
 */
function migrateLegacySessions() {
  const sessions = {};
  let found = false;

  for (const profileId of PROFILE_IDS) {
    const bankrollCents = storage.getAmount(legacyBankrollKey(profileId));
    const startingBankrollCents = storage.getAmount(legacyStartingBankrollKey(profileId));
    if (bankrollCents === null && startingBankrollCents === null) continue;
    found = true;
    // Round history and session totals were never stored before v2; they
    // legitimately restart from zero for a migrated profile.
    sessions[profileId] = { ...emptySession(), startingBankrollCents, bankrollCents };
  }

  if (found) {
    writeSessions(sessions);
    for (const profileId of PROFILE_IDS) {
      storage.clear(legacyBankrollKey(profileId));
      storage.clear(legacyStartingBankrollKey(profileId));
    }
  }
  return sessions;
}

/* ------------------------------------------------------------------- store */

/**
 * Every stored session, keyed by profile. Missing, outdated, or corrupted
 * data yields an empty map instead of throwing.
 * @returns {Record<string, object>}
 */
export function loadSessions() {
  const raw = storage.getObject(SESSIONS_KEY);
  const profiles = raw?.profiles;
  if (raw?.version !== SESSIONS_SCHEMA_VERSION
    || !profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return migrateLegacySessions();
  }

  const sessions = {};
  for (const profileId of PROFILE_IDS) {
    const session = sanitizeSession(profiles[profileId]);
    if (session) sessions[profileId] = session;
  }
  return sessions;
}

/**
 * Replace the whole store in one write.
 * @param {Record<string, object>} sessions
 */
function writeSessions(sessions) {
  storage.setObject(SESSIONS_KEY, { version: SESSIONS_SCHEMA_VERSION, profiles: sessions });
}

/**
 * The stored session for one profile, or a blank one.
 * @param {string} profileId
 * @returns {object}
 */
export function readSession(profileId) {
  return loadSessions()[profileId] ?? emptySession();
}

/**
 * Merge fields into one profile's session and commit atomically. Other
 * profiles are read back and rewritten untouched.
 * @param {string} profileId
 * @param {object} patch - any subset of the session fields
 * @returns {object} the stored record
 */
export function saveSession(profileId, patch) {
  const sessions = loadSessions();
  const merged = sanitizeSession({ ...(sessions[profileId] ?? emptySession()), ...patch })
    ?? emptySession();
  sessions[profileId] = merged;
  writeSessions(sessions);
  return merged;
}

/**
 * Start one profile's session over: bankroll, history, round count, and
 * session net all restart from `startingBankrollCents`. Written in a single
 * operation so a reload can never observe a partially reset profile, and no
 * other profile is affected.
 * @param {string} profileId
 * @param {number} startingBankrollCents
 * @returns {object} the stored record
 */
export function resetSession(profileId, startingBankrollCents) {
  if (!isPositiveMoney(startingBankrollCents)) {
    throw new Error(`Invalid starting bankroll: ${startingBankrollCents}`);
  }
  const sessions = loadSessions();
  sessions[profileId] = {
    ...emptySession(),
    startingBankrollCents,
    bankrollCents: startingBankrollCents,
  };
  writeSessions(sessions);
  return sessions[profileId];
}

/**
 * Whether a bankroll captured in this round state is worth storing.
 *
 * Mid-round the bankroll is missing its committed wagers, so persisting it
 * would make a reload look like the stake vanished. A round interrupted by a
 * reload is instead abandoned: play resumes from the last settled bankroll.
 * @param {string} roundState
 * @returns {boolean}
 */
export function isPersistableRoundState(roundState) {
  return roundState === ROUND_STATES.WAITING_FOR_BET
    || roundState === ROUND_STATES.ROUND_COMPLETE;
}

/**
 * Forget one profile entirely, leaving the others in place.
 * @param {string} profileId
 */
export function clearSession(profileId) {
  const sessions = loadSessions();
  delete sessions[profileId];
  writeSessions(sessions);
}
