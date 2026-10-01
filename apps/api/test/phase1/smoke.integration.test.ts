import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, startPhase1Platform, type Phase1Env } from "./support/harness";

describeIntegration.skipIf(!REDIS_URL)("assemblage v2 : démarrage", () => {
  let p: Phase1Env;
  beforeAll(async () => {
    p = await startPhase1Platform();
  }, 180_000);
  afterAll(async () => {
    await p?.stop();
  });

  it("charge les sept modules", () => {
    expect(p.status.modules).toEqual(expect.arrayContaining(["audit", "entitlements", "finance", "iam", "platform", "rbac", "tenancy"]));
  });
});
