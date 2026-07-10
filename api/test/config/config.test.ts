import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";

function validEnv(): NodeJS.ProcessEnv {
  return {
    SUWAYOMI_URL: "http://suwayomi:4567",
    AUTH_TOKEN: "s3cr3t-token",
    ANILIST_CLIENT_ID: "anilist-client-id",
    ANILIST_CLIENT_SECRET: "anilist-client-secret",
    ANILIST_REDIRECT_URI:
      "https://komanga.example.test/api/tracker/anilist/callback",
  };
}

describe("loadConfig", () => {
  it("loads a fully-typed config from a valid environment", () => {
    const config = loadConfig(validEnv());

    expect(config.suwayomi.url).toBe("http://suwayomi:4567");
    expect(config.auth.token).toBe("s3cr3t-token");
  });

  it("loads AniList OAuth credentials through the typed config module", () => {
    const config = loadConfig(validEnv());

    expect(config).toMatchObject({
      anilist: {
        clientId: "anilist-client-id",
        clientSecret: "anilist-client-secret",
        redirectUri:
          "https://komanga.example.test/api/tracker/anilist/callback",
      },
    });
  });

  it("applies documented defaults for optional variables", () => {
    const config = loadConfig(validEnv());

    expect(config.port).toBe(3000);
    expect(config.cache.maxBytes).toBeGreaterThan(0);
    expect(config.cache.ttlSeconds).toBeGreaterThan(0);
    expect(config.prefetch.window).toBeGreaterThan(0);
    expect(config.cbz.pageConcurrency).toBeGreaterThan(0);
    expect(config.libraryRefresh.intervalSeconds).toBeGreaterThan(0);
    expect(config.image.targetWidth).toBeGreaterThan(0);
    expect(config.image.targetHeight).toBeGreaterThan(0);
    expect(config.image.einkFormat).toBe("png");
    expect(typeof config.paths.sqliteFile).toBe("string");
    expect(typeof config.paths.cbzStore).toBe("string");
  });

  it("reads overrides for optional variables", () => {
    const config = loadConfig({
      ...validEnv(),
      PORT: "8080",
      CACHE_MAX_BYTES: "1048576",
      CACHE_TTL_SECONDS: "120",
      PREFETCH_WINDOW: "5",
      CBZ_PAGE_CONCURRENCY: "8",
      LIBRARY_REFRESH_INTERVAL_SECONDS: "3600",
      IMAGE_TARGET_WIDTH: "1264",
      IMAGE_TARGET_HEIGHT: "1680",
      IMAGE_EINK_FORMAT: "jpeg",
      DATABASE_PATH: "/data/db.sqlite",
      CBZ_STORE_PATH: "/data/cbz",
    });

    expect(config.port).toBe(8080);
    expect(config.cache.maxBytes).toBe(1048576);
    expect(config.cache.ttlSeconds).toBe(120);
    expect(config.prefetch.window).toBe(5);
    expect(config.cbz.pageConcurrency).toBe(8);
    expect(config.libraryRefresh.intervalSeconds).toBe(3600);
    expect(config.image.targetWidth).toBe(1264);
    expect(config.image.targetHeight).toBe(1680);
    expect(config.image.einkFormat).toBe("jpeg");
    expect(config.paths.sqliteFile).toBe("/data/db.sqlite");
    expect(config.paths.cbzStore).toBe("/data/cbz");
  });

  describe("fail-fast validation", () => {
    it("throws a descriptive error when SUWAYOMI_URL is missing", () => {
      const env = validEnv();
      delete env.SUWAYOMI_URL;

      expect(() => loadConfig(env)).toThrow(/SUWAYOMI_URL/);
    });

    it("throws a descriptive error when AUTH_TOKEN is missing", () => {
      const env = validEnv();
      delete env.AUTH_TOKEN;

      expect(() => loadConfig(env)).toThrow(/AUTH_TOKEN/);
    });

    it("throws a descriptive error when AniList OAuth credentials are missing", () => {
      const env = validEnv();
      delete env.ANILIST_CLIENT_ID;
      delete env.ANILIST_CLIENT_SECRET;
      delete env.ANILIST_REDIRECT_URI;

      expect(() => loadConfig(env)).toThrow(/ANILIST_CLIENT_ID/);
      expect(() => loadConfig(env)).toThrow(/ANILIST_CLIENT_SECRET/);
      expect(() => loadConfig(env)).toThrow(/ANILIST_REDIRECT_URI/);
    });

    it("treats a blank required variable as missing", () => {
      const env = { ...validEnv(), AUTH_TOKEN: "   " };

      expect(() => loadConfig(env)).toThrow(/AUTH_TOKEN/);
    });

    it("reports every missing required variable at once", () => {
      const env: NodeJS.ProcessEnv = {};

      try {
        loadConfig(env);
        expect.unreachable("loadConfig should have thrown");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/SUWAYOMI_URL/);
        expect(message).toMatch(/AUTH_TOKEN/);
        expect(message).toMatch(/ANILIST_CLIENT_ID/);
        expect(message).toMatch(/ANILIST_CLIENT_SECRET/);
        expect(message).toMatch(/ANILIST_REDIRECT_URI/);
      }
    });

    it("rejects a non-numeric numeric variable", () => {
      const env = { ...validEnv(), PORT: "not-a-number" };

      expect(() => loadConfig(env)).toThrow(/PORT/);
    });

    it("rejects a non-positive numeric variable", () => {
      const env = { ...validEnv(), PREFETCH_WINDOW: "0" };

      expect(() => loadConfig(env)).toThrow(/PREFETCH_WINDOW/);
    });

    it("accepts 0 for LIBRARY_REFRESH_INTERVAL_SECONDS (disabled)", () => {
      const config = loadConfig({
        ...validEnv(),
        LIBRARY_REFRESH_INTERVAL_SECONDS: "0",
      });

      expect(config.libraryRefresh.intervalSeconds).toBe(0);
    });

    it("rejects a negative LIBRARY_REFRESH_INTERVAL_SECONDS", () => {
      const env = { ...validEnv(), LIBRARY_REFRESH_INTERVAL_SECONDS: "-1" };

      expect(() => loadConfig(env)).toThrow(/LIBRARY_REFRESH_INTERVAL_SECONDS/);
    });

    it("rejects an unsupported eink image format", () => {
      const env = { ...validEnv(), IMAGE_EINK_FORMAT: "gif" };

      expect(() => loadConfig(env)).toThrow(/IMAGE_EINK_FORMAT/);
    });

    // KWC-102 (docs/device.md): the real Kobo Clara BW panel renders PNG and
    // JPEG but NOT WebP (nor AVIF), so `webp` is no longer a valid `eink`
    // output even though it is a perfectly good image format (RFC §6).
    it("rejects webp as an eink format", () => {
      const env = { ...validEnv(), IMAGE_EINK_FORMAT: "webp" };

      expect(() => loadConfig(env)).toThrow(/IMAGE_EINK_FORMAT/);
    });

    it("names the allowed eink formats (png, jpeg) when rejecting webp", () => {
      const env = { ...validEnv(), IMAGE_EINK_FORMAT: "webp" };

      try {
        loadConfig(env);
        expect.unreachable("loadConfig should have rejected webp");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/IMAGE_EINK_FORMAT/);
        expect(message).toMatch(/png/);
        expect(message).toMatch(/jpeg/);
      }
    });
  });

  it("accepts png and jpeg as eink formats; default stays png", () => {
    expect(loadConfig(validEnv()).image.einkFormat).toBe("png");
    expect(
      loadConfig({ ...validEnv(), IMAGE_EINK_FORMAT: "png" }).image.einkFormat,
    ).toBe("png");
    expect(
      loadConfig({ ...validEnv(), IMAGE_EINK_FORMAT: "jpeg" }).image.einkFormat,
    ).toBe("jpeg");
  });

  it("does not include the secret token in thrown error messages", () => {
    const env = { ...validEnv(), PORT: "nope", AUTH_TOKEN: "super-secret" };

    expect(() => loadConfig(env)).not.toThrow(/super-secret/);
  });

  // LOG_LEVEL feeds the pino logger (API-804/805). It is validated against the
  // standard pino level set the same fail-fast way as IMAGE_EINK_FORMAT.
  describe("LOG_LEVEL", () => {
    it("defaults to info", () => {
      expect(loadConfig(validEnv()).logLevel).toBe("info");
    });

    it("accepts the standard pino levels", () => {
      expect(loadConfig({ ...validEnv(), LOG_LEVEL: "debug" }).logLevel).toBe(
        "debug",
      );
      expect(loadConfig({ ...validEnv(), LOG_LEVEL: "warn" }).logLevel).toBe(
        "warn",
      );
      expect(loadConfig({ ...validEnv(), LOG_LEVEL: "silent" }).logLevel).toBe(
        "silent",
      );
    });

    it("rejects an unknown level via the aggregated-config-error path", () => {
      expect(() => loadConfig({ ...validEnv(), LOG_LEVEL: "loud" })).toThrow(
        /LOG_LEVEL/,
      );
    });

    it("names the allowed levels when rejecting an unknown one", () => {
      try {
        loadConfig({ ...validEnv(), LOG_LEVEL: "loud" });
        expect.unreachable("loadConfig should have rejected LOG_LEVEL=loud");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/LOG_LEVEL/);
        expect(message).toMatch(/info/);
      }
    });
  });
});
