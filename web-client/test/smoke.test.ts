import { describe, expect, it, vi } from "vitest";

// Trivial sanity test proving the runner is wired up (KWC-203). The real
// logic suites (API client, state, router, …) arrive in their own tickets;
// this just verifies `npm test` runs and the testing patterns below hold.
describe("client logic test setup", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });

  it("provides a DOM without a real browser (jsdom)", () => {
    // jsdom stands in for the panel for off-device logic. Visual correctness
    // is never asserted here — that's a [DEVICE] check on the Kobo (CLAUDE.md §4).
    const el = document.createElement("div");
    el.textContent = "ok";
    document.body.appendChild(el);

    expect(document.querySelector("div")?.textContent).toBe("ok");
  });

  it("mocks a collaborator at the call boundary", () => {
    // Pattern for the api/ boundary: pass a stubbed dependency in, assert the
    // module under test shapes the call and maps the result — no network.
    const getJson = vi.fn().mockReturnValue({ id: 7, title: "Berserk" });

    const result = getJson("/api/manga/7");

    expect(getJson).toHaveBeenCalledWith("/api/manga/7");
    expect(result).toEqual({ id: 7, title: "Berserk" });
  });
});
