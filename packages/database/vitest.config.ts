import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration créent chacun leur base ; on les sérialise pour
    // rester prévisible sur un Postgres de CI modeste.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
