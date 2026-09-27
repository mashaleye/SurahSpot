/**
 * Classify the error shown when a round cannot be built.
 *
 * The panel that renders this used to have two branches: Quran Foundation
 * credentials, and a catch-all that stated "Your Quran Foundation connection is
 * working. This error came from a round/audio resource request" and then
 * explained reciter fallback.
 *
 * For an attempt-store failure both of those sentences are false, and the
 * advice points at the wrong subsystem entirely. A real case:
 *
 *     getaddrinfo ENOTFOUND fly-example-1234.upstash.io
 *
 * — a Fly-private Redis URL left in .env.local, so a laptop could never
 * resolve it. The page confidently blamed reciters. Someone reading it would
 * check their Quran Foundation setup, re-read the reciter fallback logic, and
 * never look at the store.
 *
 * A wrong explanation is worse than none, so the classification is explicit.
 *
 * Pure and string-based on purpose: the client receives the error as a message,
 * not as a typed object, and keeping this out of the component makes it
 * testable without rendering anything.
 */

export type SetupErrorKind =
  /** Quran Foundation credentials are missing or rejected. */
  | "configuration"
  /** The shared attempt store is unreachable or refusing us. */
  | "store"
  /** Anything else: an upstream content or audio request failed. */
  | "round";

/** Missing or rejected Quran Foundation credentials. */
const CONFIGURATION = /missing qf_|client[_ -]?id|client[_ -]?secret|token request failed|401|403/i;

/**
 * Names the store outright: the backend, the provider, the variable, or a
 * Redis-level auth rejection. These are unambiguous.
 */
const STORE_NAMED = /\bredis\b|\bvalkey\b|upstash|ATTEMPT_STORE_URL|attempt store|NOAUTH|WRONGPASS/i;

/** Node's network-layer failures, which say nothing about which host. */
const NETWORK_ERRNO = /\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)\b/;

/** Mentions Quran Foundation's own hosts, so a bare errno belongs to them. */
const UPSTREAM_NAMED = /quran|qf_|recit/i;

export function classifySetupError(message: string): SetupErrorKind {
  const text = String(message ?? "");

  /*
   * Credentials first. A 401 or 403 from Quran Foundation would otherwise fall
   * through to the network check below, and "your credentials are wrong" is
   * both more specific and more actionable than "something is unreachable".
   */
  if (CONFIGURATION.test(text)) return "configuration";

  if (STORE_NAMED.test(text)) return "store";

  /*
   * A bare network errno is ambiguous — it could be the store or it could be
   * the upstream content API. It is attributed to the store only when nothing
   * in the message points upstream, because the upstream path has its own
   * retries and fallbacks and tends to name what it was fetching, whereas a
   * store failure surfaces as a raw getaddrinfo or connect error.
   */
  if (NETWORK_ERRNO.test(text) && !UPSTREAM_NAMED.test(text)) return "store";

  return "round";
}
