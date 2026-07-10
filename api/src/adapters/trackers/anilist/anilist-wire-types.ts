export interface RawMedia {
  readonly id?: unknown;
  readonly title?: {
    readonly romaji?: unknown;
    readonly english?: unknown;
    readonly native?: unknown;
  };
  readonly synonyms?: unknown;
  readonly coverImage?: {
    readonly large?: unknown;
  };
}

export interface RawListEntry {
  readonly progress?: unknown;
  readonly status?: unknown;
}

export interface RawMediaWithListEntry {
  readonly chapters?: unknown;
  readonly mediaListEntry?: RawListEntry | null;
}

export interface RawToken {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
  readonly refresh_token?: unknown;
}
