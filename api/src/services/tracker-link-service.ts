import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { BadRequestError } from "../http/errors.js";
import type { Tracker, TrackerToken } from "./ports/tracker.js";
import type { TrackerAccountRepository } from "./ports/tracker-account-repository.js";

export interface AniListOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export type TrackerLinkStatus = "pending" | "linked" | "expired";

interface LinkSession {
  readonly id: string;
  readonly authorizeUrl: string;
  readonly expiresAt: number;
  status: Exclude<TrackerLinkStatus, "expired">;
  consumed: boolean;
}

export class TrackerLinkService {
  private readonly sessions = new Map<string, LinkSession>();

  constructor(
    private readonly tracker: Tracker,
    private readonly accounts: TrackerAccountRepository,
    private readonly oauth: AniListOAuthConfig,
    private readonly ttlMs: number,
  ) {}

  createSession(): { sessionId: string; qrUrl: string } {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      authorizeUrl: this.authorizeUrl(sessionId),
      expiresAt: Date.now() + this.ttlMs,
      status: "pending",
      consumed: false,
    });

    return {
      sessionId,
      qrUrl: `/api/tracker/anilist/link/${sessionId}/qr.png`,
    };
  }

  getStatus(sessionId: string): TrackerLinkStatus {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BadRequestError("Unknown link session");
    }
    if (this.isExpired(session)) {
      return "expired";
    }
    return session.status;
  }

  async renderQrPng(sessionId: string): Promise<Buffer> {
    const session = this.sessions.get(sessionId);
    if (!session || this.isExpired(session)) {
      throw new BadRequestError("Unknown or expired link session");
    }

    return QRCode.toBuffer(session.authorizeUrl, {
      type: "png",
      margin: 2,
      width: 512,
    });
  }

  async complete(code: string, state: string): Promise<{ status: "linked" }> {
    const session = this.sessions.get(state);
    if (!session || this.isExpired(session) || session.consumed) {
      throw new BadRequestError("Invalid OAuth state");
    }

    session.consumed = true;
    const token = await this.tracker.exchangeCode(code);
    const viewer = await this.tracker.getViewer?.(token.accessToken);

    this.accounts.upsert({
      service: "anilist",
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      expiresAt: tokenExpiresAt(token),
      anilistUserId: viewer?.userId ?? "unknown",
    });
    session.status = "linked";

    return { status: "linked" };
  }

  private authorizeUrl(state: string): string {
    const url = new URL("https://anilist.co/api/v2/oauth/authorize");
    url.searchParams.set("client_id", this.oauth.clientId);
    url.searchParams.set("redirect_uri", this.oauth.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    return url.toString();
  }

  private isExpired(session: LinkSession): boolean {
    return Date.now() > session.expiresAt;
  }
}

function tokenExpiresAt(token: TrackerToken): number {
  return token.expiresAt?.getTime() ?? 0;
}
