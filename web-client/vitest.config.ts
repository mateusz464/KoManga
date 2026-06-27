import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live in test/, mirroring src/ (see CLAUDE.md §5).
    include: ["test/**/*.test.ts"],
    // jsdom gives DOM-touching logic (and XHR) a browser-shaped sandbox so
    // modules can run off-device. The panel is still the truth for anything
    // visual — those are [DEVICE] tickets, never asserted here (CLAUDE.md §4).
    environment: "jsdom",
    globals: true,
  },
});
