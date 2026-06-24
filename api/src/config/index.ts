// The only module that reads process.env (CLAUDE.md §5). Loading is fail-fast:
// it aggregates every problem and throws once, before the server listens.

export type EinkFormat = "png" | "jpeg" | "webp";

const EINK_FORMATS: readonly EinkFormat[] = ["png", "jpeg", "webp"];

export interface Config {
  readonly port: number;
  readonly suwayomi: {
    readonly url: string;
  };
  readonly auth: {
    readonly token: string;
  };
  readonly cache: {
    readonly maxBytes: number;
    readonly ttlSeconds: number;
  };
  readonly prefetch: {
    readonly window: number;
  };
  readonly image: {
    readonly targetWidth: number;
    readonly targetHeight: number;
    readonly einkFormat: EinkFormat;
  };
  readonly paths: {
    readonly sqliteFile: string;
    readonly cbzStore: string;
  };
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

const DEFAULTS = {
  PORT: 3000,
  CACHE_MAX_BYTES: 256 * 1024 * 1024,
  CACHE_TTL_SECONDS: 60 * 60,
  PREFETCH_WINDOW: 3,
  IMAGE_TARGET_WIDTH: 1072,
  IMAGE_TARGET_HEIGHT: 1448,
  IMAGE_EINK_FORMAT: "png" as EinkFormat,
  DATABASE_PATH: "./data/komanga.sqlite",
  CBZ_STORE_PATH: "./data/downloads",
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const requireString = (key: string): string => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") {
      problems.push(`${key} is required but missing or empty`);
      return "";
    }
    return raw.trim();
  };

  const optionalString = (key: string, fallback: string): string => {
    const raw = env[key];
    return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
  };

  const positiveInt = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      problems.push(`${key} must be a positive integer (got "${raw}")`);
      return fallback;
    }
    return parsed;
  };

  const einkFormat = (key: string, fallback: EinkFormat): EinkFormat => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") {
      return fallback;
    }
    const value = raw.trim().toLowerCase();
    if (!EINK_FORMATS.includes(value as EinkFormat)) {
      problems.push(
        `${key} must be one of ${EINK_FORMATS.join(", ")} (got "${raw}")`,
      );
      return fallback;
    }
    return value as EinkFormat;
  };

  const config: Config = {
    port: positiveInt("PORT", DEFAULTS.PORT),
    suwayomi: {
      url: requireString("SUWAYOMI_URL"),
    },
    auth: {
      token: requireString("AUTH_TOKEN"),
    },
    cache: {
      maxBytes: positiveInt("CACHE_MAX_BYTES", DEFAULTS.CACHE_MAX_BYTES),
      ttlSeconds: positiveInt("CACHE_TTL_SECONDS", DEFAULTS.CACHE_TTL_SECONDS),
    },
    prefetch: {
      window: positiveInt("PREFETCH_WINDOW", DEFAULTS.PREFETCH_WINDOW),
    },
    image: {
      targetWidth: positiveInt(
        "IMAGE_TARGET_WIDTH",
        DEFAULTS.IMAGE_TARGET_WIDTH,
      ),
      targetHeight: positiveInt(
        "IMAGE_TARGET_HEIGHT",
        DEFAULTS.IMAGE_TARGET_HEIGHT,
      ),
      einkFormat: einkFormat("IMAGE_EINK_FORMAT", DEFAULTS.IMAGE_EINK_FORMAT),
    },
    paths: {
      sqliteFile: optionalString("DATABASE_PATH", DEFAULTS.DATABASE_PATH),
      cbzStore: optionalString("CBZ_STORE_PATH", DEFAULTS.CBZ_STORE_PATH),
    },
  };

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return config;
}
