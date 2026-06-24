// The minimal GraphQL seam the Suwayomi adapter depends on. Keeping it this thin
// (a) stops graphql-request types leaking into our code, and (b) lets the
// adapter's mapping/error logic be tested against a mocked transport (API-201)
// without a live GraphQL server. The concrete implementation (API-202) wraps
// graphql-request's GraphQLClient and adds timeout + retry handling.

import { GraphQLClient } from "graphql-request";

export interface GraphQLTransport {
  /**
   * Execute a GraphQL document with optional variables, resolving with the raw
   * response data. Rejects on GraphQL errors and transport/network failures —
   * the adapter normalises those into a typed SuwayomiError.
   */
  request(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface GraphQLTransportOptions {
  /** Absolute URL of the Suwayomi GraphQL endpoint. */
  readonly endpoint: string;
  /** Bearer/credential header value sent on every request, if any. */
  readonly authToken?: string;
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Number of retry attempts on transport/network failure (not GraphQL errors). */
  readonly retries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 100;

/**
 * Real transport backed by graphql-request. Adds a per-request timeout (via an
 * AbortSignal) and a small bounded retry with backoff for transient transport
 * failures. GraphQL errors (a valid response carrying an `errors` array) are not
 * retried — they are deterministic and surfaced straight away.
 */
export class GraphQLRequestTransport implements GraphQLTransport {
  private readonly client: GraphQLClient;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: GraphQLTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.client = new GraphQLClient(options.endpoint, {
      headers: options.authToken
        ? { Authorization: `Bearer ${options.authToken}` }
        : {},
    });
  }

  async request(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await this.client.request({
          document,
          variables,
          signal: controller.signal,
        });
      } catch (error) {
        lastError = error;
        // A GraphQL response error is deterministic — retrying won't help.
        if (isGraphQLResponseError(error) || attempt === this.retries) {
          throw error;
        }
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    // Unreachable: the loop either returns or throws.
    throw lastError;
  }
}

function isGraphQLResponseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: unknown }).response === "object"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
