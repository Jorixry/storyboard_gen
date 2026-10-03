/**
 * Shared provider HTTP layer for the production image adapters (Prompt 7B2,
 * acceptance fix round 2026-09-23; outcome classification and literal URL
 * policy corrected in acceptance fix round 2, 2026-10-02).
 *
 * Decision record (D027 implementation convention, see docs/ARCHITECTURE.md):
 * production adapters call their providers over plain REST with the Web fetch
 * API — no vendor SDK (the Volcengine SDK is Python-only and Python is banned
 * as a production runtime) and no OpenAI SDK (Ark's Seedream-specific fields
 * such as sequential_image_generation / watermark do not fit its types, and
 * the dependency is not worth one POST). Both D027 providers (Ark Seedream,
 * DashScope Wan) therefore share this one small, fully injectable HTTP core.
 *
 * Submission policy (acceptance P1-2 + R2-1): a generation POST is NOT
 * automatically resubmitted unless the provider explicitly says the request
 * was not accepted. Only HTTP 429 carries that semantic (the server answered
 * that it throttled the request before processing it). Everything that cannot
 * prove non-execution is treated as OUTCOME-UNKNOWN: network failures,
 * per-attempt timeouts (the POST was submitted, then aborted locally —
 * cancelling the connection does not revoke a provider-side task), 5xx
 * responses, interrupted response bodies, an accepted 2xx whose body fails
 * JSON parsing or the declared contract, and failures to deliver a completed
 * generation's result image. All of these surface as errors whose message
 * warns that submitting again may incur an additional charge. Neither
 * provider documents an idempotency token for these endpoints, so none is
 * invented. "Failed requests are not billed" claims do NOT make
 * resubmission safe — the client cannot observe whether the provider
 * classified the attempt as failed.
 *
 * Total-budget policy (acceptance P1-3): the caller may pass the generation's
 * total deadline (`signal` + `deadlineAt`, armed by /api/enhanced-frame). It
 * is honored before every attempt, caps each per-attempt timeout to the
 * remaining budget, aborts an in-flight fetch, cancels backoff waits (a
 * cancelled backoff never submits a new POST) and is freed from listeners on
 * every exit path.
 *
 * - responses validated by a caller-supplied Zod schema — no provider payload
 *   is trusted beyond its declared contract;
 * - outbound URLs pass a LITERAL validation: http(s) only, and the hostname
 *   text must not be a loopback/private/reserved address literal (IPv4, IPv6
 *   including URL-normalized IPv4-mapped forms, or a localhost-style suffix).
 *   Provider endpoints are configuration, and this keeps a misconfigured base
 *   URL from naming an internal address outright. It is NOT a complete SSRF
 *   defense: DNS is not resolved and `fetch` follows redirects, so a
 *   public-looking hostname can still resolve or redirect to an internal
 *   target (documented, not silently claimed away);
 * - `fetch` and `sleep` are injected, so contract tests never touch a network.
 */
import { isIP } from "node:net";

/** Non-2xx provider response. Carries the status and raw body for error mapping. */
export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly url: string,
  ) {
    super(`provider HTTP ${status} from ${url}: ${bodyText.slice(0, 400)}`);
    this.name = "ProviderHttpError";
  }
  /**
   * True for 5xx: an error status from a gateway/server does not prove the
   * generation never ran (a proxy can fail AFTER the backend executed), so
   * callers must present these as outcome-unknown, not as safely retryable.
   */
  get outcomeUnknown(): boolean {
    return this.status >= 500;
  }
}

/** The request's outcome is unknown (never automatically resubmitted). */
export class ProviderOutcomeUnknownError extends Error {
  constructor(
    public readonly url: string,
    public readonly phase: "network" | "response-body",
    public readonly cause: unknown,
  ) {
    super(
      `provider request to ${url} failed while ${
        phase === "network" ? "sending the request" : "reading the response body"
      } (${cause instanceof Error ? cause.message : String(cause)}); the provider may have received, completed or billed this ` +
        "generation, so its outcome is unknown — submitting again may incur an additional charge",
    );
    this.name = "ProviderOutcomeUnknownError";
  }
}

/**
 * The response did not match the provider's declared Zod contract. Reached
 * only on an ACCEPTED (2xx) response — including a body that is not parseable
 * JSON — so the generation itself may have run and been billed (acceptance
 * R2-1): this is outcome-unknown, not a definitive failure.
 */
export class ProviderResponseContractError extends Error {
  constructor(
    public readonly url: string,
    public readonly detail: string,
  ) {
    super(
      `provider response failed its contract from ${url}: ${detail} — the request was ` +
        "accepted (HTTP 2xx), so the provider may have completed and billed this generation",
    );
    this.name = "ProviderResponseContractError";
  }
  get outcomeUnknown(): boolean {
    return true;
  }
}

/**
 * The request exceeded its per-attempt (or remaining-total) timeout. The POST
 * was submitted before the abort, so this is outcome-unknown exactly like the
 * route's total-budget 504 (acceptance R2-1): the local cancellation does not
 * revoke a provider-side task or guarantee that no charge occurred.
 */
export class ProviderTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(
      `provider request exceeded ${timeoutMs}ms and was aborted locally; this cancels the ` +
        "local wait and connection only — it does not cancel any task the provider may " +
        "already have accepted and does not guarantee that no charge occurred",
    );
    this.name = "ProviderTimeoutError";
  }
  get outcomeUnknown(): boolean {
    return true;
  }
}

/**
 * The provider accepted (and likely completed/billed) the generation, but its
 * result could not be delivered to the client: a plain-URL result download
 * failed or was refused, or the returned payload could not be decoded into
 * image bytes. Not a pre-submission refusal — the charge warning applies
 * (acceptance R2-1).
 */
export class ProviderResultDeliveryError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "ProviderResultDeliveryError";
  }
  get outcomeUnknown(): boolean {
    return true;
  }
}

/**
 * True when an error means the generation request was submitted (or a 2xx was
 * received) yet no usable result came back, so the provider may have completed
 * or billed it: network/body-read failures, per-attempt timeouts, 5xx
 * responses, accepted responses failing JSON parsing or the declared
 * contract, and result-delivery failures. Definite pre-submission refusals
 * (input errors, a refused generation URL, missing credentials, 4xx) answer
 * false — not every exception is outcome-unknown.
 */
export function isProviderOutcomeUnknown(error: unknown): boolean {
  if (
    error instanceof ProviderOutcomeUnknownError ||
    error instanceof ProviderTimeoutError ||
    error instanceof ProviderResponseContractError ||
    error instanceof ProviderResultDeliveryError
  ) {
    return true;
  }
  return error instanceof ProviderHttpError && error.outcomeUnknown;
}

/** The caller's total-budget signal aborted the request. */
export class ProviderAbortedError extends Error {
  constructor(public readonly reason: unknown) {
    super(
      `provider request aborted by the caller's total budget: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    );
    this.name = "ProviderAbortedError";
  }
}

/** The configured provider URL is not an allowed http(s) public endpoint. */
export class ProviderUrlError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`provider URL "${url}" is not allowed: ${reason}`);
    this.name = "ProviderUrlError";
  }
}

export interface ProviderRequestOptions<S extends import("zod").ZodTypeAny> {
  /** Zod contract the successful JSON body must satisfy. */
  schema: S;
  /**
   * Total attempts including the first (default 3). Only 429 responses are
   * retried — the sole status whose semantics explicitly say the request was
   * not accepted. Everything else fails (or reports outcome-unknown) on the
   * first attempt.
   */
  maxAttempts?: number;
  /**
   * Per-attempt abort budget in milliseconds (default 100s), capped by the
   * remaining total budget when `deadlineAt` is provided. Live-verified
   * 2026-09-22: pro-tier Seedream generation legitimately exceeds 30s; the
   * outer /api/enhanced-frame budget (120s) sits above this on purpose.
   */
  timeoutMs?: number;
  /** First backoff delay; grows exponentially per 429 retry (default 500ms). */
  initialBackoffMs?: number;
  /** Total-generation cancellation (acceptance P1-3); aborts everything. */
  signal?: AbortSignal;
  /** Epoch-ms deadline matching the signal; caps each attempt's budget. */
  deadlineAt?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to real timing. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ProviderRequestInit {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Only 429 is auto-retried: the provider explicitly refused before processing. */
const RETRYABLE_STATUS = 429;

function isPrivateOrReservedIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match === null) {
    return false;
  }
  const octets = match.slice(1).map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true; // malformed numeric host — refuse
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true; // 100.64.0.0/10 CGNAT
  }
  if (a === 169 && b === 254) {
    return true; // link-local
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true; // benchmarking
  }
  return false;
}

export function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // Classify FIRST (acceptance R2-2): a DNS name may legitimately start with
  // "fc"/"fd"/"fe80", so an IP family is never guessed from string prefixes.
  const family = isIP(host);
  if (family === 4) {
    return isPrivateOrReservedIpv4(host);
  }
  if (family === 6) {
    const groups = parseIpv6Groups(host);
    // An isIP-valid literal the parser rejects is refused, not excused.
    return groups === null ? true : isPrivateOrReservedIpv6(groups);
  }
  // Zone IDs ("%zone") only ever scope IPv6 link-local targets; a
  // numeric-but-invalid host ("999.1.1.1") is refused rather than
  // re-classified as a DNS name.
  if (host.includes("%") || /^\d+(\.\d+)*$/.test(host)) {
    return true;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

/**
 * Parses a validated IPv6 literal (no brackets, lowercase) into its eight
 * 16-bit groups, accepting "::" compression and an embedded dotted-IPv4 tail —
 * the two forms the WHATWG URL serializer emits (`http://[::ffff:127.0.0.1]/`
 * serializes its hostname as `[::ffff:7f00:1]`). Returns null for anything
 * unparseable; the caller refuses such hosts rather than guessing.
 */
function parseIpv6Groups(host: string): number[] | null {
  const halves = host.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parseHalf = (half: string): number[] | null => {
    if (half === "") {
      return [];
    }
    const pieces = half.split(":");
    const groups: number[] = [];
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]!;
      if (!piece.includes(".")) {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) {
          return null;
        }
        groups.push(Number.parseInt(piece, 16));
        continue;
      }
      // Embedded dotted IPv4: legal only as the final piece of the half.
      if (index !== pieces.length - 1) {
        return null;
      }
      const octets = piece.split(".");
      if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
        return null;
      }
      const numbers = octets.map((octet) => Number.parseInt(octet, 10));
      if (numbers.some((number) => number > 255)) {
        return null;
      }
      groups.push((numbers[0]! << 8) | numbers[1]!);
      groups.push((numbers[2]! << 8) | numbers[3]!);
    }
    return groups;
  };
  const head = parseHalf(halves[0]!);
  if (head === null) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const tail = parseHalf(halves[1]!);
  if (tail === null) {
    return null;
  }
  const compressedGroups = 8 - head.length - tail.length;
  if (compressedGroups < 1) {
    return null; // "::" must replace at least one zero group
  }
  return [...head, ...Array<number>(compressedGroups).fill(0), ...tail];
}

/** Formats the last 32 bits of a parsed IPv6 address as a dotted IPv4 host. */
function embeddedIpv4(groups: number[]): string {
  return `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
}

/**
 * Literal reserved-IPv6 policy: unspecified/loopback and the deprecated
 * IPv4-compatible `::a.b.c.d`, IPv4-mapped `::ffff:a.b.c.d`, NAT64
 * `64:ff9b::/96`, unique-local `fc00::/7` and link-local `fe80::/10`. The
 * three embedded-IPv6 forms are judged by their embedded IPv4 through the
 * same rules as native addresses (acceptance R2-2), so a mapped or translated
 * loopback/private address cannot bypass the literal check while a mapped
 * PUBLIC address stays allowed.
 */
function isPrivateOrReservedIpv6(groups: number[]): boolean {
  if (groups.slice(0, 6).every((group) => group === 0)) {
    return isPrivateOrReservedIpv4(embeddedIpv4(groups));
  }
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPrivateOrReservedIpv4(embeddedIpv4(groups));
  }
  if (
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  ) {
    return isPrivateOrReservedIpv4(embeddedIpv4(groups));
  }
  if ((groups[0]! & 0xfe00) === 0xfc00) {
    return true; // fc00::/7 unique-local
  }
  if ((groups[0]! & 0xffc0) === 0xfe80) {
    return true; // fe80::/10 link-local
  }
  return false;
}

/**
 * Server-side outbound URL policy: LITERAL validation only — http(s), no
 * embedded credentials, and the hostname text must not be a loopback,
 * private, link-local or otherwise reserved address (see
 * isPrivateOrReservedHost). Provider base URLs are environment configuration;
 * this keeps a misconfigured value from naming an internal address outright.
 * It is NOT a complete SSRF defense: nothing here resolves DNS, and `fetch`
 * follows redirects, so a public-looking hostname can still resolve or
 * redirect to an internal target.
 */
export function assertAllowedProviderUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderUrlError(rawUrl, "not a parseable absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderUrlError(rawUrl, `protocol "${parsed.protocol}" is not http(s)`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ProviderUrlError(rawUrl, "embedded credentials are not accepted");
  }
  if (isPrivateOrReservedHost(parsed.hostname)) {
    throw new ProviderUrlError(
      rawUrl,
      `host "${parsed.hostname}" is a loopback, private or reserved address`,
    );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortErrorFromSignal(signal: AbortSignal): Error {
  const reason = signal.reason;
  // A bare AbortError DOMException is the no-reason default: the only signal
  // routed here is the total-budget signal, so it still gets the explicit
  // ProviderAbortedError wording instead of an anonymous abort.
  const isBareAbort = reason instanceof DOMException && reason.name === "AbortError";
  return reason instanceof Error && !isBareAbort ? reason : new ProviderAbortedError(reason);
}

/**
 * Backoff that stays cancellable: if the total-budget signal fires while
 * waiting, the wait rejects and NO new POST is submitted.
 */
async function sleepUntilOrAbort(
  ms: number,
  signal: AbortSignal | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  if (signal === undefined) {
    await sleep(ms);
    return;
  }
  if (signal.aborted) {
    throw abortErrorFromSignal(signal);
  }
  let onAbort: (() => void) | undefined = undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortErrorFromSignal(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([sleep(ms), abortPromise]);
  } finally {
    // Never leave an abort listener attached after the wait settled.
    if (onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * POSTs one JSON request and validates the response against the schema.
 * Throws ProviderTimeoutError / ProviderHttpError / ProviderOutcomeUnknownError /
 * ProviderResponseContractError / ProviderAbortedError (or the caller's abort
 * reason). Never resubmits an outcome-unknown request.
 */
export async function postJsonForProvider<S extends import("zod").ZodTypeAny>(
  init: ProviderRequestInit,
  options: ProviderRequestOptions<S>,
): Promise<import("zod").z.infer<S>> {
  assertAllowedProviderUrl(init.url);
  const maxAttempts = options.maxAttempts ?? 3;
  const perAttemptTimeoutMs = options.timeoutMs ?? 100_000;
  const initialBackoffMs = options.initialBackoffMs ?? 500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw abortErrorFromSignal(signal);
    }
    if (attempt > 0) {
      // Only reached after a 429 (explicit not-accepted). Cancellable by the
      // total budget; a cancelled backoff never submits a new POST.
      await sleepUntilOrAbort(initialBackoffMs * 2 ** (attempt - 1), signal, sleep);
      if (signal?.aborted) {
        throw abortErrorFromSignal(signal);
      }
    }
    const remainingBudgetMs =
      options.deadlineAt !== undefined ? options.deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
    if (remainingBudgetMs <= 0) {
      throw signal !== undefined
        ? abortErrorFromSignal(signal)
        : new ProviderAbortedError("total generation budget exhausted");
    }
    const attemptBudgetMs = Math.min(perAttemptTimeoutMs, remainingBudgetMs);

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(signal!.reason);
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), attemptBudgetMs);
    // Distinguishes where a TypeError came from: before any response bytes
    // (network) or while reading an accepted response's body.
    let failurePhase: "network" | "response-body" = "network";
    try {
      const response = await fetchImpl(init.url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
      failurePhase = "response-body";
      if (!response.ok) {
        // A body-read failure here is outcome-unknown (the request WAS
        // accepted); the catch below maps it without retrying.
        const bodyText = await response.text();
        const error = new ProviderHttpError(response.status, bodyText, init.url);
        if (response.status === RETRYABLE_STATUS && attempt < maxAttempts - 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      // A parse failure on an ACCEPTED response is a contract failure
      // (outcome-unknown, acceptance R2-1); body-read and abort failures keep
      // their existing mappings in the outer catch.
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (error) {
        if (
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw error;
        }
        throw new ProviderResponseContractError(
          init.url,
          `accepted response body is not parseable JSON (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
      const result = options.schema.safeParse(parsed);
      if (!result.success) {
        throw new ProviderResponseContractError(
          init.url,
          result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      }
      return result.data;
    } catch (error) {
      if (signal?.aborted) {
        // The total budget fired: surface the caller's own reason; the
        // in-flight attempt is cancelled and nothing is resubmitted.
        throw abortErrorFromSignal(signal);
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        // Per-attempt timeout: not retried — the outcome is unknown.
        throw new ProviderTimeoutError(attemptBudgetMs);
      }
      if (error instanceof TypeError) {
        // Network failure before a response, or a broken response body. The
        // provider may still have accepted/completed/billed the request.
        throw new ProviderOutcomeUnknownError(init.url, failurePhase, error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("provider request failed");
}
