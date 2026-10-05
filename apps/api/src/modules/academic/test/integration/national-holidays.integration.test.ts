/**
 * O-10 — calendrier national des jours fériés préchargé par la plateforme, activable / désactivable par établissement.
 * Postgres réel : migration de données, RLS (référence globale en lecture seule pour un tenant, réglage isolé par tenant).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { RecordingAudit, createHoliday, listEffectiveHolidays, listNationalHolidays, setNationalHolidayEnabled } from "../../index";
import { adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { codeOf, makeWorld, type World } from "../support/world";

describeIntegration("O-10 : calendrier national des jours fériés (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });
  const newWorld = async (): Promise<World> => makeWorld(db, await db.createTenant());

  it("la migration charge UNIQUEMENT des fêtes certaines, toutes « à confirmer » ; les fêtes mobiles n'ont aucune date", async () => {
    const rows = await adminRows<{ code: string; recurrence: string; month: number | null; day: number | null; source_kind: string; needs_confirmation: boolean }>(
      db,
      "SELECT code, recurrence, month, day, source_kind, needs_confirmation FROM academic.national_holidays WHERE country_code = 'CI' ORDER BY recurrence, month, day, code",
    );
    const fixed = rows.filter((r) => r.recurrence === "FIXED_DATE").map((r) => `${r.code}:${r.month}-${r.day}`);
    expect(fixed).toEqual(["NEW_YEAR:1-1", "LABOUR_DAY:5-1", "INDEPENDENCE_DAY:8-7", "ASSUMPTION:8-15", "ALL_SAINTS:11-1", "CHRISTMAS:12-25"]);
    const movable = rows.filter((r) => r.recurrence === "MOVABLE");
    expect(movable.map((r) => r.code).sort()).toEqual(["ASCENSION", "EASTER_MONDAY", "EID_AL_ADHA", "EID_AL_FITR", "MAWLID", "WHIT_MONDAY"]);
    expect(movable.every((r) => r.month === null && r.day === null)).toBe(true);
    // jamais une valeur « confirmée » sans texte officiel
    expect(rows.every((r) => r.source_kind === "placeholder" && r.needs_confirmation)).toBe(true);
    // les dates non établies (15 novembre, 7 décembre) ne sont PAS livrées : elles restent à confirmer par le client
    expect(fixed.some((f) => /:11-15$|:12-7$/.test(f))).toBe(false);
  });

  it("la base refuse une date fixe invalide, une fête mobile datée et une fête « confirmée » sans référence (admin)", async () => {
    const ins = (v: string) => db.admin.query(`INSERT INTO academic.national_holidays (code, label, recurrence, month, day, source_kind, needs_confirmation, source_reference) VALUES ${v}`);
    await expect(ins("('BAD_DAY', 'x', 'FIXED_DATE', 2, 30, 'placeholder', true, null)")).rejects.toThrow(/national_holidays_fixed_date_ck/);
    await expect(ins("('BAD_MOVABLE', 'x', 'MOVABLE', 3, 3, 'placeholder', true, null)")).rejects.toThrow(/national_holidays_fixed_date_ck/);
    await expect(ins("('BAD_SRC', 'x', 'FIXED_DATE', 3, 3, 'regulation', false, null)")).rejects.toThrow(/national_holidays_source_ck/);
    await expect(ins("('BAD_PLACE', 'x', 'FIXED_DATE', 3, 3, 'placeholder', false, null)")).rejects.toThrow(/national_holidays_source_ck/);
  });

  it("un établissement LIT la référence mais ne peut ni l'insérer, ni la modifier (écriture réservée à `system`)", async () => {
    const w = await newWorld();
    const list = unwrap(await listNationalHolidays(w.deps, w.ctx, { institutionId: w.institutionId }));
    expect(list.filter((h) => h.recurrence === "FIXED_DATE")).toHaveLength(6);
    expect(list.every((h) => h.enabled && h.needsConfirmation && h.sourceKind === "placeholder")).toBe(true);
    await expect(w.deps.db.run(w.ctx, (tx) => tx.query("INSERT INTO academic.national_holidays (code, label, recurrence, month, day) VALUES ('X_HOL', 'x', 'FIXED_DATE', 3, 3)"))).rejects.toThrow(/row-level security/i);
    const updated = await w.deps.db.run(w.ctx, (tx) => tx.many("UPDATE academic.national_holidays SET label = 'piraté' WHERE code = 'NEW_YEAR' RETURNING code"));
    expect(updated).toHaveLength(0); // RLS : la ligne n'est pas modifiable par un tenant
    expect((await adminRows<{ label: string }>(db, "SELECT label FROM academic.national_holidays WHERE code = 'NEW_YEAR'"))[0]!.label).toBe("Jour de l'An");
  });

  it("vue effective : fêtes fixes étendues sur la plage, désactivation par établissement, jours ajoutés, fêtes mobiles saisies par l'école", async () => {
    const w = await newWorld();
    const range = { institutionId: w.institutionId, from: "2026-08-01", to: "2027-01-31" };
    const all = unwrap(await listEffectiveHolidays(w.deps, w.ctx, range));
    expect(all.map((h) => `${h.startsOn}:${h.ref}`)).toEqual(["2026-08-07:INDEPENDENCE_DAY", "2026-08-15:ASSUMPTION", "2026-11-01:ALL_SAINTS", "2026-12-25:CHRISTMAS", "2027-01-01:NEW_YEAR"]);
    expect(all.every((h) => h.origin === "NATIONAL" && h.needsConfirmation && h.blocksTeaching)).toBe(true);

    // l'établissement désactive la Toussaint (audit) : elle disparaît de SA vue
    const off = unwrap(await setNationalHolidayEnabled(w.deps, w.ctx, { institutionId: w.institutionId, code: "ALL_SAINTS", enabled: false }));
    expect(off.enabled).toBe(false);
    expect((w.audit as RecordingAudit).entries.find((e) => e.entry.action === "academic.national_holiday.toggled")?.entry).toMatchObject({ before: { enabled: true }, after: { enabled: false } });
    expect(unwrap(await listEffectiveHolidays(w.deps, w.ctx, range)).map((h) => h.ref)).not.toContain("ALL_SAINTS");
    expect(unwrap(await listNationalHolidays(w.deps, w.ctx, { institutionId: w.institutionId })).find((h) => h.code === "ALL_SAINTS")?.enabled).toBe(false);

    // il ajoute son propre jour (ici une fête mobile dont il saisit la date) : fusionné à la vue
    unwrap(await createHoliday(w.deps, w.ctx, { institutionId: w.institutionId, label: "Aïd (date saisie par l'école)", startsOn: "2026-09-10" }));
    const merged = unwrap(await listEffectiveHolidays(w.deps, w.ctx, range));
    expect(merged.map((h) => `${h.startsOn}:${h.origin}`)).toEqual(["2026-08-07:NATIONAL", "2026-08-15:NATIONAL", "2026-09-10:INSTITUTION", "2026-12-25:NATIONAL", "2027-01-01:NATIONAL"]);
    expect(merged.find((h) => h.origin === "INSTITUTION")?.needsConfirmation).toBe(false);

    // réactivation
    unwrap(await setNationalHolidayEnabled(w.deps, w.ctx, { institutionId: w.institutionId, code: "ALL_SAINTS", enabled: true }));
    expect(unwrap(await listEffectiveHolidays(w.deps, w.ctx, range)).map((h) => h.ref)).toContain("ALL_SAINTS");

    // code inconnu / plage invalide
    expect(codeOf(await setNationalHolidayEnabled(w.deps, w.ctx, { institutionId: w.institutionId, code: "INCONNU_X", enabled: false }))).toBe("academic.national_holiday_not_found");
    expect(codeOf(await listEffectiveHolidays(w.deps, w.ctx, { ...range, to: "2026-01-01" }))).toBe("academic.holiday_dates_invalid");
  });

  it("RLS A/B : la désactivation d'un tenant n'affecte jamais l'autre, et ses lignes lui sont invisibles", async () => {
    const a = await newWorld();
    const b = await newWorld();
    unwrap(await setNationalHolidayEnabled(a.deps, a.ctx, { institutionId: a.institutionId, code: "CHRISTMAS", enabled: false }));
    const range = { from: "2026-12-01", to: "2026-12-31" };
    expect(unwrap(await listEffectiveHolidays(a.deps, a.ctx, { institutionId: a.institutionId, ...range }))).toEqual([]);
    expect(unwrap(await listEffectiveHolidays(b.deps, b.ctx, { institutionId: b.institutionId, ...range })).map((h) => h.ref)).toEqual(["CHRISTMAS"]);
    // lecture directe sous la RLS de B : aucune ligne de réglage de A
    const seenByB = await b.deps.db.run(b.ctx, (tx) => tx.many("SELECT id FROM academic.institution_national_holiday_settings"));
    expect(seenByB).toEqual([]);
    // B ne peut pas écrire un réglage pour le tenant A (tenant_id imposé par la session)
    const rowsA = await adminRows<{ tenant_id: string }>(db, "SELECT tenant_id FROM academic.institution_national_holiday_settings WHERE national_holiday_code = 'CHRISTMAS'");
    expect(rowsA.map((r) => r.tenant_id)).toEqual([a.tenantId]);
    // un contexte limité à un autre établissement ne voit pas le premier (404)
    const scoped = { ...a.ctx, institutionId: b.institutionId };
    expect(codeOf(await listNationalHolidays(a.deps, scoped, { institutionId: a.institutionId }))).toBe("academic.institution_not_found");
  });
});
