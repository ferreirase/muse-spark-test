import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
