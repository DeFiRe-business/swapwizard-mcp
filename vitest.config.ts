import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 10_000,
    restoreMocks: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
