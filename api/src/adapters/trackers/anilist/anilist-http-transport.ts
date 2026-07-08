import { GraphQLClient } from "graphql-request";
import { isGraphQLResponseError } from "./anilist-errors.js";
import type {
  AniListHttpTransportOptions,
  AniListTokenRequest,
  AniListTransport,
} from "./anilist-types.js";

const GRAPHQL_ENDPOINT = "https://graphql.anilist.co";
const TOKEN_ENDPOINT = "https://anilist.co/api/v2/oauth/token";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 100;

export class AniListHttpTransport implements AniListTransport {
  private readonly client: GraphQLClient;
  private readonly tokenEndpoint: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: AniListHttpTransportOptions = {}) {
    this.client = new GraphQLClient(
      options.graphqlEndpoint ?? GRAPHQL_ENDPOINT,
    );
    this.tokenEndpoint = options.tokenEndpoint ?? TOKEN_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  async request(
    document: string,
    variables?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<unknown> {
    return this.withRetry((signal) =>
      this.client.request({
        document,
        variables,
        requestHeaders: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
        signal,
      }),
    );
  }

  async postToken(request: AniListTokenRequest): Promise<unknown> {
    return this.withRetry(async (signal) => {
      const response = await fetch(this.tokenEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(request),
        signal,
      });
      const data = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) {
        throw new Error(
          `AniList token exchange failed with ${response.status}`,
        );
      }
      return data;
    });
  }

  private async withRetry<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await operation(controller.signal);
      } catch (error) {
        lastError = error;
        if (isGraphQLResponseError(error) || attempt === this.retries) {
          throw error;
        }
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
