// SEC-02 : le dÃ©ploiement par dÃ©faut ne doit pas exposer les comptes techniques (identifiants + mot de passe).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { technicalAccountsEnabled } from "@/lib/technical-accounts.server";

describe("dÃ©fauts de sÃ©curitÃ© du dÃ©ploiement", () => {
  it("docker-compose : SHOW_TECHNICAL_ACCOUNTS vaut false par dÃ©faut", () => {
    const compose = readFileSync(resolve(__dirname, "../../../../infra/compose/docker-compose.yml"), "utf8");
    expect(compose).toMatch(/SHOW_TECHNICAL_ACCOUNTS: \$\{SHOW_TECHNICAL_ACCOUNTS:-false\}/);
  });

  it("production sans rÃ©glage explicite : panneau coupÃ©", () => {
    const prev = { ...process.env };
    try {
      delete process.env.SHOW_TECHNICAL_ACCOUNTS;
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(technicalAccountsEnabled()).toBe(false);
    } finally {
      process.env = prev;
    }
  });
});

