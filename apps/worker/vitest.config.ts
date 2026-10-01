import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration partagent un Postgres et un Redis : on les sérialise.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
