/**
 * Storage contract for everything that must survive between requests.
 *
 * SurahSpot's anti-cheat rules — two hints per attempt, one-shot round
 * revisions, seven rounds per attempt — are only sound if every request for a
 * given attempt observes the same state and mutations are serialized. The
 * original implementation held that in a module-level Map, which is correct on
 * one long-lived Node process and silently wrong on Vercel, Cloud Run, or any
 * multi-replica deployment: a player could land on a fresh instance and get two
 * more hints.
 *
 * This interface is deliberately tiny — get, set, delete, withLock — so a new
 * backend is a single small file. Nothing above this layer knows whether the
 * data lives in a Map or in Redis.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;

  /**
   * Run `fn` with exclusive access to `key`. Implementations must serialize
   * concurrent callers rather than failing fast, because two hint requests
   * arriving together is normal double-tap behaviour, not an error.
   */
  withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T>;

  /** Best-effort liveness probe used by /api/health. */
  ping(): Promise<boolean>;

  /** Human-readable backend name, surfaced in the health endpoint. */
  readonly name: string;
}

/**
 * The store could not be reached or refused us.
 *
 * Exists so the boundary between "the store is down" and "something unexpected
 * happened" is a type rather than a regex over an error message. Two places
 * need that distinction and neither can safely guess it:
 *
 * - `toErrorResponse` maps this to 503 with a message naming the subsystem but
 *   not the host. A raw connection failure reads
 *   `getaddrinfo ENOTFOUND fly-….upstash.io`, which is useful in a log and is
 *   internal infrastructure detail in a browser.
 * - The client's setup panel used to assert that any non-credential failure
 *   came from a round or audio request, and then explain reciter fallback. For
 *   a store failure that is wrong twice over, and it sends the reader to the
 *   wrong subsystem entirely.
 *
 * The distinction cannot be recovered from the message alone: a Quran
 * Foundation outage produces the same ENOTFOUND shape, so guessing would only
 * move the misattribution rather than remove it.
 */
export class StoreUnavailableError extends Error {
  readonly backend: string;

  constructor(backend: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`The ${backend} attempt store is unavailable: ${detail}`);
    this.name = "StoreUnavailableError";
    this.backend = backend;
    this.cause = cause;
  }
}

/** Whether a thrown value is a store-reachability failure. */
export function isStoreUnavailable(error: unknown): error is StoreUnavailableError {
  return error instanceof StoreUnavailableError || (error as Error | null)?.name === "StoreUnavailableError";
}
