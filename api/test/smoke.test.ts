import { describe, expect, it } from "vitest";

// Trivial sanity test proving the runner is wired up (API-102).
describe("tooling smoke test", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
