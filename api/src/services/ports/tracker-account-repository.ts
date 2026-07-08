export type TrackerService = "anilist";

export interface TrackerAccount {
  readonly service: TrackerService;
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresAt: number; // epoch ms
  readonly anilistUserId: string;
}

export interface TrackerAccountRepository {
  get(service: TrackerService): TrackerAccount | undefined;
  // Single-user account storage: a new account for a service replaces the old one.
  upsert(account: TrackerAccount): void;
}
