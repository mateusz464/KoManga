import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live in test/, mirroring src/ (see CLAUDE.md §3).
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
