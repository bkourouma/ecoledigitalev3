/**
 * Onboarding piloté par événements (spec 031) : `imports.run.completed` complète « Importer les élèves » et « Importer les
 * enseignants ». Règles pures (`onboardingStepForImport`) et intégration sur Postgres réel (idempotence, étapes déjà
 * résolues, établissement en production, isolation entre tenants).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock, createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import { completeOnboardingStep, getOnboarding, provisionTenant, type TenancyDeps } from "../index";
import { completeOnboardingOnImport, IMPORT_RUN_COMPLETED, ONBOARDING_STEP_BY_IMPORTER, onboardingStepForImport } from "../application/onboarding-events";
import manifest from "../manifest";
import subscribers from "../subscribers";
import { TENANCY_MIGRATIONS, createTestDb, describeIntegration, type TestDb } from "./support/db";

describe("onboarding piloté par les imports : règles pures", () => {
  it("seuls les imports d'élèves et de personnel correspondent à une étape", () => {
    expect(ONBOARDING_STEP_BY_IMPORTER).toEqual({ students: "STUDENT_IMPORT", staff: "TEACHERS" });
    expect(onboardingStepForImport({ importerKey: "students", created: 10, updated: 0, skipped: 0 })).toBe("STUDENT_IMPORT");
    expect(onboardingStepForImport({ importerKey: "staff", created: 0, updated: 2, skipped: 0 })).toBe("TEACHERS");
    expect(onboardingStepForImport({ importerKey: "students", created: 0, updated: 0, skipped: 5 })).toBe("STUDENT_IMPORT"); // rejeu : les élèves sont bien là
    for (const importerKey of ["guardians", "classrooms", "curriculum", "grades", "opening_balances", "inconnu"]) expect(onboardingStepForImport({ importerKey, created: 9 }), importerKey).toBeNull();
  });

  it("un import qui n'a rien produit (tout refusé) ne marque rien ; payload mal formé ignoré", () => {
    expect(onboardingStepForImport({ importerKey: "students", created: 0, updated: 0, skipped: 0 })).toBeNull();
    expect(onboardingStepForImport({})).toBeNull();
    expect(onboardingStepForImport({ importerKey: 12, created: "10" })).toBeNull();
  });

  it("l'abonné est déclaré dans le manifeste et écoute imports.run.completed", () => {
    expect(manifest.events.consumes).toContain(IMPORT_RUN_COMPLETED);
    const sub = (subscribers as Array<{ name: string; pattern: string | RegExp }>).find((s) => s.name === "tenancy.onboarding-on-import-completed");
    expect(sub?.pattern).toBe(IMPORT_RUN_COMPLETED);
  });
});

describeIntegration("onboarding piloté par les imports : intégration", () => {
  let db: TestDb;
  let deps: TenancyDeps;
  const clock = new ManualClock("2026-10-01T08:00:00.000Z");
  let A: string;
  let B: string;

  async function provision(slug: string): Promise<string> {
    return unwrap(await provisionTenant(deps, { name: `Groupe ${slug}`, slug, countryCode: "CI", packs: ["SECONDARY"], adminContact: { name: "Awa Koné", email: `direction@${slug}.ci`, phone: "+225 07 00 00 00 00" } })).tenantId;
  }
  const status = async (tenantId: string, step: string): Promise<string | undefined> => {
    const state = unwrap(await getOnboarding(deps, createRequestContext({ tenantId, userId: newId(), roles: ["director"] })));
    return state.steps.find((s) => s.key === step)?.status;
  };

  beforeAll(async () => {
    db = await createTestDb([TENANCY_MIGRATIONS]);
    deps = { db: db.tenantDb, clock };
    A = await provision("onb-a");
    B = await provision("onb-b");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("un import d'élèves terminé complète « Importer les élèves », un import de personnel « Importer les enseignants »", async () => {
    expect(await status(A, "STUDENT_IMPORT")).toBe("PENDING");
    expect(await completeOnboardingOnImport(deps, A, { importerKey: "students", created: 120, updated: 0, skipped: 0 })).toEqual({ marked: "STUDENT_IMPORT" });
    expect(await status(A, "STUDENT_IMPORT")).toBe("COMPLETED");
    expect(await status(A, "TEACHERS")).toBe("PENDING");
    expect(await completeOnboardingOnImport(deps, A, { importerKey: "staff", created: 14 })).toEqual({ marked: "TEACHERS" });
    expect(await status(A, "TEACHERS")).toBe("COMPLETED");
  });

  it("idempotent : rejouer l'événement (ou un second import) ne produit aucune erreur", async () => {
    expect(await completeOnboardingOnImport(deps, A, { importerKey: "students", created: 3 })).toEqual({ ignored: "already_resolved" });
    expect(await status(A, "STUDENT_IMPORT")).toBe("COMPLETED");
  });

  it("n'agit que sur le tenant de l'événement (isolation) ; un import sans donnée ou d'un autre type ne marque rien", async () => {
    expect(await status(B, "STUDENT_IMPORT")).toBe("PENDING");
    expect(await completeOnboardingOnImport(deps, B, { importerKey: "students", created: 0, updated: 0, skipped: 0 })).toEqual({ ignored: "no_step" });
    expect(await completeOnboardingOnImport(deps, B, { importerKey: "classrooms", created: 12 })).toEqual({ ignored: "no_step" });
    expect(await status(B, "STUDENT_IMPORT")).toBe("PENDING");
    expect(await status(B, "TEACHERS")).toBe("PENDING");
  });

  it("une étape ignorée (SKIPPED) peut ensuite être complétée par un import ; un établissement en production ou sans onboarding n'est pas une erreur", async () => {
    const ctxB = createRequestContext({ tenantId: B, userId: newId(), roles: ["director"] });
    const skipped = await (await import("../index")).skipOnboardingStep(deps, ctxB, "STUDENT_IMPORT");
    expect(skipped.ok).toBe(true);
    expect(await completeOnboardingOnImport(deps, B, { importerKey: "students", created: 5 })).toEqual({ marked: "STUDENT_IMPORT" });
    expect(await status(B, "STUDENT_IMPORT")).toBe("COMPLETED");
    // tenant inconnu : pas d'onboarding -> ignoré proprement
    const unknown = newId();
    await db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [unknown, `onb-${unknown.slice(-8)}`, "Sans onboarding"]);
    expect(await completeOnboardingOnImport(deps, unknown, { importerKey: "students", created: 5 })).toEqual({ ignored: "onboarding_unavailable" });
    void completeOnboardingStep;
  });
});
