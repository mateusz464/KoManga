export interface AniListTokenRequest {
  readonly grant_type: "authorization_code";
  readonly client_id: string;
  readonly client_secret: string;
  readonly redirect_uri: string;
  readonly code: string;
}

export interface AniListTransport {
  request(
    document: string,
    variables?: Record<string, unknown>,
    accessToken?: string,
  ): Promise<unknown>;
  postToken(request: AniListTokenRequest): Promise<unknown>;
}

export interface AniListTrackerOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly accessToken?: string;
}

export interface AniListHttpTransportOptions {
  readonly graphqlEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
}
