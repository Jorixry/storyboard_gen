/**
 * Shared provider HTTP layer for the production image adapters (Prompt 7B2).
 *
 * Decision record (D027 implementation convention, see docs/ARCHITECTURE.md):
 * production adapters call their providers over plain REST with the Web fetch
 * API — no vendor SDK (the Volcengine SDK is Python-only and Python is banned
 * as a production runtime) and no OpenAI SDK (Ark's Seedream-specific fields
 * such as sequential_image_generation / watermark do not fit its types, and
 * the dependency is not worth one POST). Both D027 providers (Ark Seedream,
 * DashScope Wan) therefore share this one small, fully injectable HTTP core:
 *
 * - per-attempt timeout via AbortController (the caller's generation budget);
 * - bounded retry with exponential backoff on 429/5xx/network errors ONLY
 *   (both documented providers bill successful outputs only, so a failed
 *   attempt is safe to retry);
 * - responses validated by a caller-supplied Zod schema — no provider payload
 *   is trusted beyond its declared contract;
 * - `fetch` and `sleep` are injected, so contract tests never touch a network.
 */

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
}

/** The response did not match the provider's declared Zod contract. */
export class ProviderResponseContractError extends Error {
  constructor(
    public readonly url: string,
    public readonly detail: string,
  ) {
    super(`provider response failed its contract from ${url}: ${detail}`);
    this.name = "ProviderResponseContractError";
  }
}

/** The request exceeded its per-attempt timeout. */
export class ProviderTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`provider request exceeded ${timeoutMs}ms and was aborted`);
    this.name = "ProviderTimeoutError";
  }
}

export interface ProviderRequestOptions<S extends import("zod").ZodTypeAny> {
  /** Zod contract the successful JSON body must satisfy. */
  schema: S;
  /** Total attempts including the first (default 3). Retries only 429/5xx/network. */
  maxAttempts?: number;
  /** Per-attempt abort budget in milliseconds (default 30s). */
  timeoutMs?: number;
  /** First backoff delay; grows exponentially per retry (default 500ms). */
  initialBackoffMs?: number;
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

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs one JSON request and validates the response against the schema.
 * Throws ProviderTimeoutError / ProviderHttpError / ProviderResponseContractError
 * (or the fetch error itself for a final network failure).
 */
export async function postJsonForProvider<S extends import("zod").ZodTypeAny>(
  init: ProviderRequestInit,
  options: ProviderRequestOptions<S>,
): Promise<import("zod").z.infer<S>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const initialBackoffMs = options.initialBackoffMs ?? 500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(initialBackoffMs * 2 ** (attempt - 1));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(init.url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text();
        const error = new ProviderHttpError(response.status, bodyText, init.url);
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts - 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const parsed: unknown = await response.json();
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
      const isAbort =
        error instanceof DOMException && error.name === "AbortError"
          ? new ProviderTimeoutError(timeoutMs)
          : null;
      if (isAbort !== null) {
        // Timeouts are not retried: the caller's own budget governs.
        throw isAbort;
      }
      const retryableNetwork =
        error instanceof TypeError /* fetch network failure */ && attempt < maxAttempts - 1;
      if (retryableNetwork) {
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("provider request failed");
}
