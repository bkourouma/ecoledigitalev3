/**
 * Comportement SQL de la migration 2203 (effets d'une exclusion) et des extensions de 2202 (audiences du personnel, refus par
 * défaut d'une donnée absente) : scénarios en SQL brut sous `app_user`, sans couche applicative.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTenant, insert, newTenant, uuid, type SqlTx } from "./support/sql-harness";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "./support/db";

describeIntegration("schoollife : effets d'exclusion et audiences du personnel (SQL)", () => {
  let m: ModuleTestDb;
  const PROPOSER = uuid();
  const VALIDATOR = uuid();
  beforeAll(async () => {
    m = await createModuleTestDb();
  });
  afterAll(async () => {
    await m?.drop();
  });

  const mk = (tx: SqlTx, table: string, cols: Record<string, unknown>) => insert(tx, table, { id: uuid(), tenant_id: tx.tenantId, ...cols });
  const asUser = async <T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> => inTenant(m.admin, { tenantId: await newTenant(m.admin, "e"), userId: PROPOSER, actor: "user" }, fn);

  async function validatedExclusion(tx: SqlTx): Promise<{ measureId: string; studentId: string }> {
    const type = await mk(tx, "schoollife.event_types", { code: "EXCL", label: "Exclusion", kind: "TEMP_EXCLUSION", requires_validation: true, requires_four_eyes: true, requires_dates: true });
    const studentId = uuid();
    const measureId = await mk(tx, "schoollife.measures", {
      institution_id: uuid(), academic_year_id: uuid(), enrollment_id: uuid(), student_id: studentId, type_id: type, reason: "Comportement répété en classe",
      starts_on: "2026-11-10", ends_on: "2026-11-12", proposed_by: PROPOSER, proposed_by_name: "Éducateur",
    });
    expect((await tx.q("SELECT count(*)::int AS n FROM schoollife.measure_effects WHERE measure_id = $1", [measureId]))[0].n).toBe(0); // proposée : aucun effet
    await tx.as({ userId: VALIDATOR });
    await tx.q("UPDATE schoollife.measures SET status = 'VALIDATED', validated_by_name = 'D' WHERE id = $1", [measureId]);
    return { measureId, studentId };
  }

  it("une exclusion validée crée UN effet AWAITING_HUMAN ; jamais d'effet à la proposition ; jamais de suppression", async () => {
    await asUser(async (tx) => {
      const { measureId } = await validatedExclusion(tx);
      const effects = await tx.q("SELECT status, effect_kind, applied_by FROM schoollife.measure_effects WHERE measure_id = $1", [measureId]);
      expect(effects).toEqual([{ status: "AWAITING_HUMAN", effect_kind: "STUDENT_STATUS_REQUEST", applied_by: null }]);
      await tx.fail("DELETE FROM schoollife.measure_effects", [], /permission denied|42501/);
      await tx.fail("INSERT INTO schoollife.measure_effects (id, tenant_id, measure_id, student_id, effect_kind) VALUES ($1,$2,$3,$4,'STUDENT_STATUS_REQUEST')", [uuid(), tx.tenantId, measureId, uuid()], /unique|23505/); // un effet vivant par mesure
    });
  });

  it("application : acte d'un utilisateur seulement (base), applied_by posé par la base, transitions légales, état final protégé", async () => {
    await asUser(async (tx) => {
      const { measureId } = await validatedExclusion(tx);
      const id = (await tx.one("SELECT id FROM schoollife.measure_effects WHERE measure_id = $1", [measureId])).id as string;
      await tx.as({ actor: "system", userId: "" });
      await tx.fail("UPDATE schoollife.measure_effects SET status = 'APPLIED', applied_status = 'SUSPENDED' WHERE id = $1", [id], /human_actor_required/);
      await tx.as({ actor: "superAdmin", userId: VALIDATOR });
      await tx.fail("UPDATE schoollife.measure_effects SET status = 'APPLIED', applied_status = 'SUSPENDED' WHERE id = $1", [id], /human_actor_required/);
      await tx.as({ actor: "user", userId: VALIDATOR });
      await tx.fail("UPDATE schoollife.measure_effects SET status = 'APPLIED' WHERE id = $1", [id], /check|23514/); // statut d'élève choisi par l'humain obligatoire
      await tx.fail("UPDATE schoollife.measure_effects SET status = 'REVERTED', revert_reason = 'Motif suffisant' WHERE id = $1", [id], /effect_transition/); // pas de levée sans application
      await tx.q("UPDATE schoollife.measure_effects SET status = 'APPLIED', applied_status = 'SUSPENDED', applied_by = $2 WHERE id = $1", [id, PROPOSER]);
      const row = await tx.one("SELECT applied_by, applied_at FROM schoollife.measure_effects WHERE id = $1", [id]);
      expect(row.applied_by).toBe(VALIDATOR); // falsification impossible
      expect(row.applied_at).toBeTruthy();
      await tx.fail("UPDATE schoollife.measure_effects SET status = 'AWAITING_HUMAN' WHERE id = $1", [id], /effect_transition/);
      await tx.fail("UPDATE schoollife.measure_effects SET status = 'SKIPPED', skipped_reason = 'Motif suffisant' WHERE id = $1", [id], /effect_transition/);
    });
  });

  it("création directe d'un effet déjà appliqué refusée ; l'annulation de la mesure écarte l'effet en attente", async () => {
    await asUser(async (tx) => {
      const { measureId, studentId } = await validatedExclusion(tx);
      await tx.q("UPDATE schoollife.measures SET status = 'CANCELLED', cancel_reason = 'Erreur de saisie' WHERE id = $1", [measureId]);
      const e = await tx.one("SELECT status, skipped_reason FROM schoollife.measure_effects WHERE measure_id = $1", [measureId]);
      expect(e).toMatchObject({ status: "SKIPPED", skipped_reason: "Mesure annulée" });
      await tx.fail(
        "INSERT INTO schoollife.measure_effects (id, tenant_id, measure_id, student_id, effect_kind, status, applied_status, applied_at, applied_by) VALUES ($1,$2,$3,$4,'STUDENT_STATUS_REQUEST','APPLIED','EXCLUDED',now(),$5)",
        [uuid(), tx.tenantId, measureId, studentId, PROPOSER],
        /human_application_required/,
      );
    });
  });

  it("audience_may_see : une donnée absente (NULL) vaut refus, jamais NULL", async () => {
    await asUser(async (tx) => {
      const v = async (...a: unknown[]) => (await tx.one("SELECT schoollife.audience_may_see($1,$2,$3,$4,$5,$6) AS v", a)).v;
      expect(await v("GUARDIAN", "NOTE", "STANDARD", true, "ACTIVE", null)).toBe(false);
      expect(await v("GUARDIAN", "MEASURE", "STANDARD", true, null, null)).toBe(false);
      expect(await v("STAFF_STANDARD", "INCIDENT", "STANDARD", null, "DECLARED", null)).toBe(true);
      expect(await v("STAFF_STANDARD", "INCIDENT", null, null, "DECLARED", null)).toBe(false); // confidentialité inconnue : refus
      expect(await v(null, "INCIDENT", "STANDARD", true, "DECLARED", null)).toBe(false);
    });
  });
});
