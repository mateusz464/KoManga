import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createPinoLogger } from "../../../src/adapters/logging/pino-logger.js";

// Exercises the REAL pino library writing to a captured in-memory stream, so the
// exact emitted bytes can be asserted.
function collectingStream(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString("utf8") };
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

describe("createPinoLogger", () => {
  it("implements the Logger port's level methods", () => {
    const { stream } = collectingStream();
    const logger = createPinoLogger({
      level: "info",
      authToken: "tok",
      stream,
    });

    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("writes one structured JSON line per log, carrying message + fields", () => {
    const { stream, text } = collectingStream();
    const logger = createPinoLogger({
      level: "info",
      authToken: "tok",
      stream,
    });

    logger.info("page served", { mangaId: 7, profile: "eink" });

    const out = lines(text());
    expect(out).toHaveLength(1);
    // JSON, not pretty — the line parses and structured fields are merged in.
    const entry = JSON.parse(out[0]) as Record<string, unknown>;
    expect(entry.msg).toBe("page served");
    expect(entry.mangaId).toBe(7);
    expect(entry.profile).toBe("eink");
    expect(typeof entry.level).toBe("number");
  });

  it("honours the configured level, dropping lower-severity logs", () => {
    const { stream, text } = collectingStream();
    const logger = createPinoLogger({
      level: "warn",
      authToken: "tok",
      stream,
    });

    logger.info("suppressed");
    logger.warn("kept");

    const msgs = lines(text()).map(
      (line) => (JSON.parse(line) as { msg: string }).msg,
    );
    expect(msgs).toEqual(["kept"]);
  });

  // --- Redaction: the security-critical contract (CLAUDE.md §5/§9). ---
  it("redacts an Authorization header so the bearer secret never serializes", () => {
    const token = "s3cr3t-bearer-value";
    const { stream, text } = collectingStream();
    const logger = createPinoLogger({
      level: "info",
      authToken: token,
      stream,
    });

    logger.info("request", {
      req: { headers: { authorization: `Bearer ${token}` } },
    });

    const raw = text();
    expect(raw).not.toContain(token);
    const entry = JSON.parse(lines(raw)[0]) as {
      req: { headers: { authorization: string } };
    };
    expect(entry.req.headers.authorization).toBe("[Redacted]");
  });

  it("never writes the configured secret token, even when logged directly", () => {
    const token = "another-super-secret-token";
    const { stream, text } = collectingStream();
    const logger = createPinoLogger({
      level: "info",
      authToken: token,
      stream,
    });

    // Whether it arrives as a field value or embedded in the message, grepping
    // the captured bytes must not find the secret.
    logger.info("leaky", { token });
    logger.error(`token is ${token}`);

    expect(text()).not.toContain(token);
  });
});
