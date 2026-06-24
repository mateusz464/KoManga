import { GraphQLClient } from "graphql-request";

export interface GraphQLTransport {
  request(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface GraphQLTransportOptions {
  readonly endpoint: string;
  readonly authToken?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 100;

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
