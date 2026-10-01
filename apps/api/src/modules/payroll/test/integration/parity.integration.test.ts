/**
 * PARITÉ CHIFFRÉE avec le scénario de caractérisation `paie-enseignants` (tests/characterization, snapshot du code
 * legacy figé) : le MÊME jeu de données (9 enseignants, séances d'ECUE et présences, 30 étapes du parcours S17-T)
 * est rejoué sur le module payroll ; chaque montant est comparé à celui du legacy. Les écarts acceptés sont de trois
 * natures, TOUS documentés ci-dessous avec « valeur legacy » vs « valeur correcte » :
 *
 *   A. les 6 bogues du legacy, CORRIGÉS (jamais reproduits) ;
 *   B. l'entier : le legacy produit des décimaux (363 636,36), le v2 des francs entiers (363 636, demi-supérieur) ;
 *   C. la précision du tarif : le scénario déclare 3 333,33 F/h ; le v2 stocke des tarifs ENTIERS (3 333).
 *
 * Aucun écart non expliqué n'est toléré : la table ACCEPTED_DEVIATIONS est exhaustive et vérifiée.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError, newId, type AppError } from "@ecoledigitale/kernel";
import { calculatePeriod, type CalculationReport } from "../../application/calculate";
import { adjustPayslip, approvePayslips, cancelPayslip, payPayslips } from "../../application/workflow";
import { createPayConfig, createHourlyRate } from "../../application/configs";
import { createPeriod, setPeriodStatus } from "../../application/periods";
import { payabilityBlockers, retainedMinutes } from "../../domain/payability";
import type { HourFact } from "../../domain/types";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { createWorld, unwrap, type World } from "../support/world";
import scenario from "../../../../../../../tests/characterization/scenarios/paie-enseignants.scenario";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(here, "../../../../../../../tests/characterization/snapshots/paie-enseignants.snapshot.json");
const legacy = JSON.parse(readFileSync(snapshotPath, "utf8")) as { data: Record<string, any>; knownLegacyDefects: Array<{ id: string }> };
const legacyStep = (prefix: string): any => legacy.data[Object.keys(legacy.data).find((k) => k.startsWith(prefix)) as string];
const legacyResults = (prefix: string): Map<string, any> => new Map<string, any>((legacyStep(prefix).response.body.data.results as any[]).map((r: any) => [r.teacherName as string, r]));
const num = (v: unknown): number => Number(v);

/** Écarts ACCEPTÉS (exhaustifs). `legacy` / `v2` sont lus dans le snapshot et dans l'exécution : ils ne sont pas recopiés à la main. */
interface Deviation {
  id: string;
  kind: "BUG_CORRECTED" | "INTEGER_ROUNDING" | "RATE_PRECISION" | "REASON_CODE" | "VALIDATION_RULE";
  where: string;
  legacy: string | number | null;
  v2: string | number | null;
  note: string;
}
const deviations: Deviation[] = [];
const accept = (d: Deviation): void => {
  deviations.push(d);
};

const idOf = (() => {
  const ids = new Map<string, string>();
  return (key: string): string => {
    let id = ids.get(key);
    if (!id) {
      id = newId();
      ids.set(key, id);
    }
    return id;
  };
})();

describeIntegration("parité avec le scénario de caractérisation `paie-enseignants`", () => {
  let db: PayrollTestDb;
  let w: World;
  const setup = scenario.payroll!.setup;
  const steps = scenario.payroll!.steps;
  const teacherName = new Map(scenario.teachers.map((t) => [t.key, `${t.firstName} ${t.lastName}`]));
  const staffOf = (key: string): string => idOf(`teacher:${key}`);
  const nodeOf = (key: string): string => idOf(`node:${key}`);
  const periodIds = new Map<string, string>();
  const sessionFacts = new Map<string, HourFact>();
  const state = {
    reports: new Map<string, CalculationReport>(), // clé : `${étape}`
    preview: new Map<string, number>(),
    refusals: new Map<number, { status: number; code: string } | "OK">(),
  };

  const syncSessions = (): void => {
    w.mem.sessions.clear();
    w.mem.sessions.add(...sessionFacts.values());
  };
  const ctx = () => w.ctxOf();
  const httpStatusOf = (e: AppError): number => e.httpStatus;

  beforeAll(async () => {
    db = await createPayrollTestDb(16);
    w = await createWorld({ db });
    // --- personnel -----------------------------------------------------------------------------------------------
    for (const t of scenario.teachers) w.mem.staff.add({ staffId: staffOf(t.key), displayName: teacherName.get(t.key) as string, active: true });
    w.mem.staff.nameUser(w.accountant, "Comptable Test");
    // --- configurations (heures -> minutes, majoration -> ‰ ; 40 h / ×1,5 par défaut = réglages du tenant) ---------------
    for (const c of setup.configs) {
      unwrap(
        await createPayConfig(w.deps, ctx(), {
          staffId: staffOf(c.teacher),
          type: c.type.toUpperCase() as "SALARY" | "HOURLY" | "MIXED",
          ...(c.monthlySalary !== undefined ? { monthlySalary: c.monthlySalary } : {}),
          ...(c.hourlyRate !== undefined ? { defaultHourlyRate: Math.round(c.hourlyRate) } : {}),
          ...(c.overtimeThreshold !== undefined ? { overtimeThresholdMinutes: Math.round(c.overtimeThreshold * 60) } : {}),
          ...(c.overtimeMultiplier !== undefined ? { overtimeMultiplierPermille: Math.round(c.overtimeMultiplier * 1000) } : {}),
          effectiveFrom: c.from,
          ...(c.to ? { effectiveTo: c.to } : {}),
        }),
      );
    }
    // --- tarifs par nœud (ECUE et matières : un seul référentiel) --------------------------------------------------------
    for (const r of setup.rates) {
      unwrap(await createHourlyRate(w.deps, ctx(), { curriculumNodeId: nodeOf((r.ecue ?? r.course) as string), rate: r.amount, validFrom: r.from, ...(r.teacher ? { staffId: staffOf(r.teacher) } : {}) }));
    }
    // --- séances d'ECUE (origine SESSION) -------------------------------------------------------------------------------
    for (const s of setup.seances) {
      sessionFacts.set(s.key, {
        kind: "SESSION",
        refId: idOf(`seance:${s.key}`),
        staffId: staffOf(s.teacher),
        date: s.date,
        startTime: s.start ?? null,
        endTime: s.end ?? null,
        durationMinutes: null,
        paidMinutesOverride: s.paidVolume !== undefined ? Math.round(s.paidVolume * 60) : null,
        realized: s.status === "realisee",
        validated: s.validated === true,
        nodeId: nodeOf(s.ecue),
        classroomId: null,
        label: s.ecue,
        code: s.ecue,
        classroomLabel: null,
      });
    }
    syncSessions();
    // --- présences enseignants (origine ATTENDANCE) -----------------------------------------------------------------------
    for (const a of setup.academicSessions) {
      w.mem.attendance.add({
        kind: "ATTENDANCE",
        refId: idOf(`attendance:${a.key}`),
        staffId: staffOf(a.teacher),
        date: a.date,
        startTime: null,
        endTime: null,
        durationMinutes: Math.round(a.hours * 60),
        paidMinutesOverride: null,
        realized: a.status === "completed",
        validated: true,
        nodeId: nodeOf(a.course),
        classroomId: idOf(`class:${a.class}`),
        label: a.course,
        code: a.course,
        classroomLabel: a.class,
      });
    }
  });
  afterAll(async () => {
    await db.drop();
    // l'inventaire des écarts est publié dans le journal de test (reporté dans specs/v2/032-payroll-port/parity.md)
    console.info(`[parité] écarts acceptés (${deviations.length}) :\n${deviations.map((d) => `  - [${d.kind}] ${d.id} @ ${d.where} : legacy=${d.legacy} v2=${d.v2} — ${d.note}`).join("\n")}`);
  });

  // --- rejeu des 30 étapes ----------------------------------------------------------------------------------------------
  const payslipOf = async (periodKey: string, teacherKey: string): Promise<Record<string, any> | undefined> =>
    (
      await adminRows(
        db,
        "SELECT * FROM payroll.payslips WHERE tenant_id=$1 AND period_id=$2 AND staff_id=$3 ORDER BY created_at DESC, id DESC",
        [w.tenantId, periodIds.get(periodKey), staffOf(teacherKey)],
      )
    )[0];
  const idsOf = async (periodKey: string, teacherKeys: string[]): Promise<string[]> => {
    const ids: string[] = [];
    for (const t of teacherKeys) {
      const p = await payslipOf(periodKey, t);
      if (p) ids.push(p.id as string);
    }
    return ids;
  };
  const SCOPE = { all: "ALL", academique: "ATTENDANCE", professionnel: "SESSION" } as const;
  const label = (i: number): string => `${String(i + 1).padStart(2, "0")}-`;

  it("rejoue les 30 étapes du parcours S17-T et compare chaque résultat au snapshot du legacy", async () => {
    for (const [i, step] of steps.entries()) {
      const key = label(i);
      const lg = legacyStep(key);
      switch (step.do) {
        case "create-period": {
          const r = await createPeriod(w.deps, ctx(), { name: step.name, startDate: step.start as string, endDate: step.end as string, academicYearId: w.yearId, ...(step.teachers ? { staffIds: step.teachers.map(staffOf) } : {}) });
          if (!r.ok) {
            // refus de validation : même statut HTTP que le legacy (400 nom vide / dates inversées ; 409 période déjà en attente)
            expect(httpStatusOf(r.error), step.label).toBe(lg.status);
            if (step.label.includes("déjà en attente")) expect(r.error.code).toBe("payroll.period_pending");
          } else if (lg.status !== 200 && lg.status !== 201) {
            // seul écart : la période d'UN SEUL JOUR (legacy : 400 « la date de début doit précéder la date de fin »)
            expect(step.label).toMatch(/un seul jour/);
            accept({ id: "SINGLE_DAY_PERIOD", kind: "VALIDATION_RULE", where: step.label, legacy: lg.status, v2: 201, note: "le DDL de référence autorise end_date >= start_date : une période d'un jour est licite (prorata d'un jour ouvré) ; archivée par le test pour ne pas bloquer l'étape suivante" });
            unwrap(await setPeriodStatus(w.deps, ctx(), { periodId: r.value.id, status: "ARCHIVED" }));
          } else {
            periodIds.set(step.period, r.value.id);
          }
          break;
        }
        case "set-paid-volume": {
          const fact = sessionFacts.get(step.seance) as HourFact;
          const candidate: HourFact = { ...fact, paidMinutesOverride: step.volume === null ? null : Math.round(step.volume * 60) };
          if (retainedMinutes(candidate) === null) {
            expect(lg.status, step.label).toBe(422); // refus identique : durée payée impossible (sans horaires, ou nulle)
          } else {
            expect(lg.status, step.label).toBeLessThan(300);
            sessionFacts.set(step.seance, candidate);
            syncSessions();
          }
          break;
        }
        case "validate-seances": {
          const updated: string[] = [];
          const rejected: Array<{ key: string; blockers: string[] }> = [];
          for (const k of step.seances) {
            const fact = sessionFacts.get(k) as HourFact;
            const blockers = payabilityBlockers({ ...fact, validated: true });
            if (blockers.length === 0) {
              sessionFacts.set(k, { ...fact, validated: step.validated });
              updated.push(k);
            } else rejected.push({ key: k, blockers });
          }
          syncSessions();
          const lgData = lg.body.data;
          expect(updated.length).toBe(lgData.updated);
          expect(rejected.map((r) => r.key)).toEqual(lgData.rejected.map((r: any) => String(r.seanceId).replace("seance:", "")));
          // motifs : STATUT_NON_REALISEE ↔ NOT_REALIZED (même prédicat, défini une seule fois)
          expect(rejected[0]?.blockers).toEqual(["NOT_REALIZED"]);
          expect(lgData.rejected[0].reason).toBe("STATUT_NON_REALISEE");
          break;
        }
        case "calculate": {
          const input = { periodId: periodIds.get(step.period) as string, ...(step.dryRun ? { dryRun: true } : {}), ...(step.recalculate ? { recalculate: true } : {}), ...(step.scope ? { scope: SCOPE[step.scope] } : {}), ...(step.teachers ? { staffIds: step.teachers.map(staffOf) } : {}) };
          const report = unwrap(await calculatePeriod(w.deps, ctx(), input));
          state.reports.set(key, report);
          break;
        }
        case "adjust": {
          const p = (await payslipOf(step.period, step.teacher)) as Record<string, any>;
          let add: Array<{ kind: "BONUS" | "DEDUCTION"; amount: number; label: string }>;
          if (p.status === "CALCULATED") {
            // « PATCH ajustements » du legacy FIXE prime et retenue ; en v2 ce sont des lignes tracées : on ajoute l'écart
            // (la saisie rétablie à l'étape 15 est donc un no-op, puisque les ajustements ont été conservés au recalcul)
            const wantBonus = step.bonus ?? 0;
            const wantDeduction = step.deductions ?? 0;
            add = [
              ...(wantBonus - Number(p.bonus_amount) > 0 ? [{ kind: "BONUS" as const, amount: wantBonus - Number(p.bonus_amount), label: "Prime" }] : []),
              ...(wantDeduction - Number(p.deduction_amount) > 0 ? [{ kind: "DEDUCTION" as const, amount: wantDeduction - Number(p.deduction_amount), label: "Retenue" }] : []),
            ];
            if (add.length === 0) {
              state.refusals.set(i, "OK");
              break;
            }
          } else {
            add = [{ kind: "BONUS", amount: step.bonus ?? 1, label: "Prime tardive" }]; // bulletin arrêté : doit être REFUSÉ
          }
          const r = await adjustPayslip(w.deps, ctx(), { payslipId: p.id, add });
          if (!r.ok) {
            expect(httpStatusOf(r.error), step.label).toBe(lg.status); // 409 « paiement verrouillé » dans les deux mondes
            state.refusals.set(i, { status: httpStatusOf(r.error), code: r.error.code });
          } else {
            state.refusals.set(i, "OK");
          }
          break;
        }
        case "approve": {
          const ids = await idsOf(step.period, step.teachers ?? []);
          unwrap(await approvePayslips(w.deps, ctx(), { selection: { payslipIds: ids }, caps: { ownerApproval: false } }));
          break;
        }
        case "pay": {
          const ids = await idsOf(step.period, step.teachers ?? []);
          const r = unwrap(await payPayslips(w.deps, ctx(), { selection: { payslipIds: ids }, method: "CASH" }));
          state.refusals.set(i, r.rejected.length > 0 ? { status: 409, code: r.rejected[0]?.code as string } : "OK");
          break;
        }
        case "cancel": {
          for (const id of await idsOf(step.period, step.teachers ?? [])) unwrap(await cancelPayslip(w.deps, ctx(), { payslipId: id, reason: "Annulation du scénario" }));
          break;
        }
        case "force-status": {
          // Legacy : `PATCH /:id/status` acceptait n'importe quel statut. v2 : aucune route, l'action `pay` refuse, la base refuse.
          const p = (await payslipOf(step.period, step.teacher)) as Record<string, any>;
          const before = p.status;
          const r = unwrap(await payPayslips(w.deps, ctx(), { selection: { payslipIds: [p.id] }, method: "CASH" }));
          expect(r.done, step.label).toEqual([]);
          expect(r.rejected[0]?.code).toBe("payroll.invalid_transition");
          await expect(db.admin.query("UPDATE payroll.payslips SET status='PAID', paid_at=now(), paid_by=$2, paid_by_name='X', payment_method='CASH' WHERE id=$1", [p.id, newId()])).rejects.toThrow(/payroll\.invalid_transition/);
          expect((await payslipOf(step.period, step.teacher))?.status, step.label).toBe(before);
          state.refusals.set(i, { status: 409, code: "payroll.invalid_transition" });
          break;
        }
        case "archive": {
          // Legacy : « tout archiver » touchait AUSSI les bulletins annulés. v2 : « tout arrêter » par période, côté serveur.
          for (const pid of periodIds.values()) unwrap(await approvePayslips(w.deps, ctx(), { selection: { all: true, periodId: pid }, caps: { ownerApproval: false } }));
          break;
        }
        case "set-seance-status": {
          // Legacy : annuler une séance rattachée à un bulletin approuvé est REFUSÉ (409). v2 : l'arrêt du bulletin a GELÉ
          // l'heure à la source (`HoursSourcePort.lock` = `scheduling.lockHours`) ; le refus est celui de 017 (hours_locked).
          const fact = sessionFacts.get(step.seance) as HourFact;
          const frozen = [...w.mem.sessions.locks.values()].some((lines) => lines.some((l) => l.refId === fact.refId && l.staffId === fact.staffId));
          expect(frozen, step.label).toBe(true);
          expect(lg.status, step.label).toBe(409);
          break;
        }
        default:
          throw new Error(`étape non gérée : ${(step as { do: string }).do}`);
      }
    }
    expect(state.reports.size).toBeGreaterThan(0);
  });

  // --- comparaisons chiffrées ---------------------------------------------------------------------------------------------------
  const outcome = (stepNo: number, teacherKey: string) => state.reports.get(label(stepNo - 1))?.items.find((x) => x.staffId === staffOf(teacherKey));
  const total = (stepNo: number, teacherKey: string): number | undefined => outcome(stepNo, teacherKey)?.total?.amount;

  it("aperçu (étape 10) et calcul réel (étape 11) : montants identiques au legacy, à l'unité de franc près", () => {
    const lgPreview = legacyResults("10-");
    const lgReal = legacyResults("11-");
    const rows: Array<{ teacher: string; key: string; legacyPreview: number; legacyReal: number | null; v2: number; kind: "EXACT" | "INTEGER_ROUNDING" | "RATE_PRECISION" }> = [];
    for (const key of ["acad", "awa", "cent", "diallo", "mixte", "mixte2"]) {
      const name = teacherName.get(key) as string;
      const legacyPreview = num(lgPreview.get(name).totalAmount);
      const real = lgReal.get(name);
      const v2 = total(11, key) as number;
      expect(v2, `${name} calculé en v2`).toBeTypeOf("number");
      // l'aperçu v2 = le calcul réel v2
      expect(state.reports.get(label(9))?.items.find((x) => x.staffId === staffOf(key))?.total?.amount, `aperçu ${name}`).toBe(v2);
      const diff = Math.abs(legacyPreview - v2);
      const kind = diff === 0 ? "EXACT" : diff <= 0.5 ? "INTEGER_ROUNDING" : "RATE_PRECISION";
      rows.push({ teacher: name, key, legacyPreview, legacyReal: real.status === "calculated" ? num(real.totalAmount) : null, v2, kind });
    }
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    // identiques
    expect(byKey.acad).toMatchObject({ legacyPreview: 32_000, v2: 32_000, kind: "EXACT" });
    expect(byKey.awa).toMatchObject({ legacyPreview: 55_000, v2: 55_000, kind: "EXACT" });
    // à l'unité de franc près (B) : le legacy publie des décimaux, le v2 des francs entiers (demi-supérieur)
    expect(byKey.diallo).toMatchObject({ v2: 363_636, kind: "INTEGER_ROUNDING" });
    expect(byKey.diallo?.legacyPreview).toBeCloseTo(363_636.3636, 3);
    expect(byKey.mixte2).toMatchObject({ v2: 126_909, kind: "INTEGER_ROUNDING" });
    expect(byKey.mixte2?.legacyPreview).toBeCloseTo(126_909.0909, 3);
    expect(byKey.mixte).toMatchObject({ v2: 344_818, kind: "INTEGER_ROUNDING" });
    expect(byKey.mixte?.legacyPreview).toBeCloseTo(344_818.1818, 3);
    for (const k of ["diallo", "mixte2", "mixte"]) {
      accept({ id: `INTEGER_${k.toUpperCase()}`, kind: "INTEGER_ROUNDING", where: "aperçu/calcul", legacy: byKey[k]?.legacyPreview ?? null, v2: byKey[k]?.v2 ?? null, note: "entiers XOF, arrondi demi-supérieur (R-PAY-07)" });
    }
    // (C) précision du tarif : 3 333,33 → 3 333 ; v2 exact pour SES données : 10 h × 3 333 + 4 h × 3 333 × 1,5
    expect(byKey.cent).toMatchObject({ v2: 10 * 3333 + 4 * 3333 * 1.5, kind: "RATE_PRECISION" });
    expect(byKey.cent?.legacyPreview).toBeCloseTo(53_333.28, 2);
    accept({ id: "CENT_RATE_PRECISION", kind: "RATE_PRECISION", where: "aperçu/calcul", legacy: byKey.cent?.legacyPreview ?? null, v2: byKey.cent?.v2 ?? null, note: "tarif 3 333,33 F/h déclaré par le scénario : le v2 stocke des tarifs entiers (3 333) ; écart = 10 h × 0,33 + 4 h × 0,33 × 1,5 ≈ 5,3 F" });
    console.table(rows);
  });

  it("écartés : mêmes motifs que le legacy (NO_CONFIG, NO_RATE_RESOLVED, NO_HOURS)", () => {
    const lg = legacyResults("11-");
    for (const [key, reason] of [["kone", "NO_CONFIG"], ["notarif", "NO_RATE_RESOLVED"], ["vide", "NO_HOURS"]] as const) {
      const name = teacherName.get(key) as string;
      expect(lg.get(name).skipReason).toBe(reason);
      expect(outcome(11, key)).toMatchObject({ outcome: "SKIPPED", skipReason: reason, staffName: name });
    }
  });

  it("BOGUE 1 — séance à cheval sur le seuil : le legacy n'avait AUCUN bulletin (erreur d'unicité) ; le v2 le produit avec deux lignes", async () => {
    const lg = legacyResults("11-").get("Marc Mixte");
    expect(lg.status).toBe("error");
    expect(lg.error ?? lg.message).toMatch(/uniq_phd_payment_seance|duplicate key/);
    const p = await payslipOf("janvier", "mixte");
    expect(outcome(11, "mixte")).toMatchObject({ outcome: "CALCULATED" }); // produit dès le calcul (le legacy : erreur)
    expect(p?.status).toBe("APPROVED"); // puis arrêté par « tout arrêter » (étape 30)
    const lines = await adminRows<{ source_ref_id: string; minutes: number; is_overtime: boolean; multiplier_permille: number; amount: string; source_kind: string }>(
      db,
      "SELECT source_ref_id, minutes, is_overtime, multiplier_permille, amount::text, source_kind FROM payroll.payslip_lines WHERE payslip_id=$1 ORDER BY position",
      [p?.id],
    );
    const m2 = lines.filter((l) => l.source_ref_id === idOf("seance:m2"));
    expect(m2.map((l) => [l.minutes, l.is_overtime, l.multiplier_permille, l.amount])).toEqual([[120, false, 1000, "18000"], [120, true, 1500, "27000"]]);
    // chiffres : régulières 82 000 + supplémentaires 81 000 + salaire 181 818 = 344 818
    expect([p?.base_amount, p?.overtime_amount, p?.salary_amount, p?.total_amount]).toEqual(["263818", "81000", "181818", "344818"]);
    accept({ id: "OVERTIME_SPLIT", kind: "BUG_CORRECTED", where: "étape 11 (Marc Mixte)", legacy: "aucun bulletin (erreur uniq_phd_payment_seance)", v2: 344_818, note: "PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE : la séance m2 est coupée en deux lignes (120 min normales + 120 min majorées)" });
    expect(legacy.knownLegacyDefects.map((d) => d.id)).toContain("PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE");
  });

  it("BOGUE 2 — périodes chevauchantes : le legacy versait deux salaires (363 636,36 et 90 909,09) ; le v2 ne paie jamais deux fois le même jour", async () => {
    const lg = legacyStep("26-").payments;
    expect(num(lg["janvier-bis/diallo"].total_amount)).toBeCloseTo(363_636.36, 2); // le défaut
    expect(num(lg["janvier-bis/mixte2"].total_amount)).toBeCloseTo(90_909.09, 2);
    expect(await payslipOf("janvier-bis", "diallo")).toBeUndefined();
    expect(await payslipOf("janvier-bis", "mixte2")).toBeUndefined();
    expect(outcome(26, "diallo")).toMatchObject({ outcome: "SKIPPED", skipReason: "NOTHING_TO_PAY" });
    expect(outcome(26, "mixte2")).toMatchObject({ outcome: "SKIPPED", skipReason: "NOTHING_TO_PAY" });
    // jamais plus d'un paiement par jour ouvré
    expect((await adminRows(db, "SELECT 1 FROM payroll.salary_day_claims WHERE tenant_id=$1 GROUP BY staff_id, work_date HAVING count(*) > 1", [w.tenantId])).length).toBe(0);
    accept({ id: "OVERLAP_SALARY_DIALLO", kind: "BUG_CORRECTED", where: "étape 26 (diallo)", legacy: 363_636.36, v2: 0, note: "PAYMENT_OVERLAPPING_PERIOD_DOUBLES_SALARY : seconde période = NOTHING_TO_PAY, aucun second salaire" });
    accept({ id: "OVERLAP_SALARY_MIXTE2", kind: "BUG_CORRECTED", where: "étape 26 (mixte2)", legacy: 90_909.09, v2: 0, note: "idem ; les heures de mixte2 déjà payées par le 1er bulletin restent exclues (comme le legacy)" });
    // l'ancien motif « NO_HOURS » devient plus précis : les heures existent mais sont DÉJÀ payées
    expect(legacyResults("26-").get("Awa Sanogo").skipReason).toBe("NO_HOURS");
    expect(outcome(26, "awa")).toMatchObject({ outcome: "SKIPPED", skipReason: "NOTHING_TO_PAY" });
    accept({ id: "REASON_AWA", kind: "REASON_CODE", where: "étape 26 (awa, cent)", legacy: "NO_HOURS", v2: "NOTHING_TO_PAY", note: "heures présentes mais déjà portées par un bulletin non annulé : motif plus précis" });
    // l'heure annulée est relâchée : acad est recalculée dans la 2e période, au même montant
    expect(total(26, "acad")).toBe(32_000);
    expect(num(lg["janvier-bis/acad"].total_amount)).toBe(32_000);
  });

  it("BOGUE 3 — « tout archiver » ne ressuscite plus les bulletins annulés", async () => {
    const lg = legacyStep("30-").payments;
    expect(lg["janvier/acad"].status).toBe("approved"); // le défaut : un annulé redevient « approuvé »
    expect((await payslipOf("janvier", "acad"))?.status).toBe("CANCELLED");
    accept({ id: "ARCHIVE_REVIVES_CANCELLED", kind: "BUG_CORRECTED", where: "étape 30 (acad)", legacy: "approved", v2: "CANCELLED", note: "PAYMENT_ARCHIVE_REVIVES_CANCELLED : un bulletin annulé est terminal ; « tout arrêter » (all:true) ne touche que les CALCULATED" });
    // le second bulletin d'acad (période 2, calculé après annulation) est, lui, bien arrêté
    expect((await payslipOf("janvier-bis", "acad"))?.status).toBe("APPROVED");
    // et les bulletins qui pouvaient l'être l'ont été : cent, mixte2, mixte (calculés) → arrêtés
    for (const k of ["cent", "mixte2", "mixte"]) expect((await payslipOf("janvier", k))?.status, k).toBe("APPROVED");
    expect((await payslipOf("janvier", "awa"))?.status).toBe("PAID");
    expect((await payslipOf("janvier", "diallo"))?.status).toBe("PAID");
  });

  it("BOGUE 4 — pas de statut libre ni d'approbateur codé en dur : annulé → payé et calculé → payé refusés ; l'auteur est l'utilisateur authentifié", async () => {
    const lg28 = legacyStep("28-").payments;
    expect(lg28["janvier/acad"].status).toBe("paid"); // le défaut
    expect(state.refusals.get(27)).toEqual({ status: 409, code: "payroll.invalid_transition" });
    expect(state.refusals.get(28)).toEqual({ status: 409, code: "payroll.invalid_transition" });
    const authors = await adminRows<{ approved_by: string | null; paid_by: string | null }>(db, "SELECT approved_by, paid_by FROM payroll.payslips WHERE tenant_id=$1 AND (approved_by IS NOT NULL OR paid_by IS NOT NULL)", [w.tenantId]);
    expect(authors.length).toBeGreaterThan(0);
    expect(authors.every((a) => [a.approved_by, a.paid_by].filter(Boolean).every((u) => u === w.accountant))).toBe(true);
    expect(authors.some((a) => String(a.approved_by).startsWith("634a57fe") || String(a.paid_by).startsWith("634a57fe"))).toBe(false);
    accept({ id: "STATUS_FREE_PATCH", kind: "BUG_CORRECTED", where: "étapes 28-29 (acad)", legacy: "paid", v2: "transition refusée (409 payroll.invalid_transition)", note: "PAYMENT_STATUS_ENDPOINT_NO_STATE_MACHINE : machine d'états imposée par trigger ; aucune route PATCH /status" });
  });

  it("BOGUE 5 — lignes cohérentes avec le montant : legacy 4 h × 5 000,00 = 19 999,98 ; v2 : chaque ligne = la formule, Σ lignes + salaire = total, pour TOUS les bulletins", async () => {
    // le défaut, dans le snapshot du legacy
    const cent = legacyStep("11-").payments["janvier/cent"];
    const overtimeLine = cent.hourDetails.find((l: any) => l.is_overtime);
    const legacyProduct = num(overtimeLine.hours_count) * num(overtimeLine.hourly_rate);
    expect(num(overtimeLine.amount)).not.toBe(legacyProduct);
    accept({ id: "LINES_ROUNDING", kind: "BUG_CORRECTED", where: "étape 11 (cent, ligne majorée)", legacy: `${overtimeLine.hours_count} h × ${overtimeLine.hourly_rate} = ${legacyProduct} mais enregistré ${overtimeLine.amount}`, v2: "ligne = floor((240×3333×1500+30000)/60000) = 19998 ; Σ lignes = total", note: "PAYSLIP_LINES_ROUNDING : montant de ligne = formule exacte, vérifiée par CHECK ; le total est la somme des lignes PAR CONSTRUCTION" });
    // le v2 : formule et somme sur tous les bulletins, y compris le tarif non entier à l'heure
    const lines = await adminRows<{ minutes: number; rate: string; multiplier_permille: number; amount: string }>(db, "SELECT minutes, rate::text, multiplier_permille, amount::text FROM payroll.payslip_lines WHERE tenant_id=$1", [w.tenantId]);
    expect(lines.length).toBeGreaterThan(8);
    for (const l of lines) expect(Number(l.amount)).toBe(Math.floor((l.minutes * Number(l.rate) * l.multiplier_permille + 30000) / 60000));
    const slips = await adminRows<{ id: string; status: string; salary_amount: string; total_amount: string; bonus_amount: string; deduction_amount: string }>(db, "SELECT id, status, salary_amount::text, total_amount::text, bonus_amount::text, deduction_amount::text FROM payroll.payslips WHERE tenant_id=$1 AND status <> 'CANCELLED'", [w.tenantId]);
    for (const s of slips) {
      const sum = await adminRows<{ s: string }>(db, "SELECT coalesce(sum(amount),0)::text s FROM payroll.payslip_lines WHERE payslip_id=$1", [s.id]);
      expect(Number(s.total_amount), s.id).toBe(Number(sum[0]?.s) + Number(s.salary_amount) + Number(s.bonus_amount) - Number(s.deduction_amount));
    }
    // 4 h × (3 333 × 1,5) = 4 × 4 999,5 = 19 998 : la ligne ne s'écarte pas de sa définition
    const centP = await payslipOf("janvier", "cent");
    const overtime = await adminRows<{ amount: string; minutes: number }>(db, "SELECT amount::text, minutes FROM payroll.payslip_lines WHERE payslip_id=$1 AND is_overtime", [centP?.id]);
    expect(overtime).toEqual([{ amount: "19998", minutes: 240 }]);
  });

  it("BOGUE 6 — le recalcul CONSERVE prime (5 000) et retenue (2 000) : le legacy les remettait à 0", async () => {
    const lg14 = legacyStep("14-").payments["janvier/awa"];
    expect(num(lg14.bonus_amount)).toBe(0); // le défaut (étape 13 : prime 5 000 saisie juste avant)
    expect(num(legacyStep("13-").body.data.bonusAmount)).toBe(5000);
    const awa = await payslipOf("janvier", "awa");
    expect([awa?.bonus_amount, awa?.deduction_amount, awa?.total_amount]).toEqual(["5000", "2000", "58000"]);
    // à l'étape 14 (recalcul) le total v2 portait déjà prime et retenue
    expect(total(14, "awa")).toBe(58_000);
    expect(num(legacyStep("16-").payments["janvier/awa"].total_amount)).toBe(58_000); // après ré-saisie : même total qu'en v2
    accept({ id: "RECALC_ERASES_ADJUSTMENTS", kind: "BUG_CORRECTED", where: "étape 14 (awa)", legacy: `prime ${lg14.bonus_amount} / total ${lg14.total_amount}`, v2: "prime 5000 / retenue 2000 / total 58000", note: "PAYMENT_RECALCULATE_ERASES_ADJUSTMENTS : les ajustements vivent dans leur table, le recalcul ne les touche pas" });
  });

  it("verrous : un bulletin approuvé n'est pas réécrit par le recalcul (signalé) ni ajustable ; second calcul sans recalcul = bulletins existants ; versements idempotents / refus", () => {
    // étape 12 : legacy « bulletins existants » (rien ne change) ↔ v2 ALREADY_CALCULATED
    expect(outcome(12, "awa")).toMatchObject({ outcome: "SKIPPED", skipReason: "ALREADY_CALCULATED" });
    // étape 17 : approuvés verrouillés (legacy aussi : prime 5 000 conservée sur l'approuvé)
    expect(outcome(17, "awa")).toMatchObject({ outcome: "LOCKED", skipReason: "PAYSLIP_LOCKED" });
    expect(outcome(17, "diallo")).toMatchObject({ outcome: "LOCKED" });
    expect(legacyStep("17-").payments["janvier/awa"].status).toBe("approved");
    // étape 18 : ajustement d'un approuvé refusé (409) dans les deux mondes
    expect(state.refusals.get(17)).toEqual({ status: 409, code: "payroll.payslip_locked" });
    expect(legacyStep("18-").status).toBe(409);
    // étape 23 : verser un bulletin non approuvé refusé
    expect(state.refusals.get(22)).toMatchObject({ code: "payroll.invalid_transition" });
    expect(legacyStep("23-").payments["janvier/acad"].status).toBe("calculated");
    // étapes 20-22 : versements (le second est idempotent)
    expect(state.refusals.get(19)).toBe("OK");
    expect(state.refusals.get(20)).toBe("OK");
    expect(state.refusals.get(21)).toBe("OK");
  });

  it("T18 — Σ présences + Σ séances + hors-heures = total, sur tout le tenant, par statut", async () => {
    const rows = await w.db.tenantDb.run(ctx(), (tx) =>
      tx.many<{ a: string; s: string; o: string; t: string }>("SELECT attendance_amount::text a, session_amount::text s, out_of_hours_amount::text o, total_amount::text t FROM payroll.v_payslip_breakdown"),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(Number(r.a) + Number(r.s) + Number(r.o)).toBe(Number(r.t));
    // Marc Mixte a des heures des DEUX origines sur UN seul bulletin
    const marc = await payslipOf("janvier", "mixte");
    const origins = await adminRows<{ source_kind: string }>(db, "SELECT DISTINCT source_kind FROM payroll.payslip_lines WHERE payslip_id=$1 ORDER BY 1", [marc?.id]);
    expect(origins.map((o) => o.source_kind)).toEqual(["ATTENDANCE", "SESSION"]);
  });

  it("inventaire des écarts : exhaustif et sans écart inexpliqué", () => {
    const bugs = deviations.filter((d) => d.kind === "BUG_CORRECTED").map((d) => d.id);
    // les 6 bogues du legacy sont tous documentés (valeur legacy vs valeur correcte)
    expect(bugs).toEqual(expect.arrayContaining(["OVERTIME_SPLIT", "OVERLAP_SALARY_DIALLO", "ARCHIVE_REVIVES_CANCELLED", "STATUS_FREE_PATCH", "LINES_ROUNDING", "RECALC_ERASES_ADJUSTMENTS"]));
    expect(new Set(deviations.map((d) => d.id)).size).toBe(deviations.length);
    const known = new Set(["INTEGER_DIALLO", "INTEGER_MIXTE2", "INTEGER_MIXTE", "CENT_RATE_PRECISION", "SINGLE_DAY_PERIOD", "REASON_AWA", "OVERLAP_SALARY_MIXTE2", ...bugs]);
    expect(deviations.every((d) => known.has(d.id))).toBe(true);
    // 6 des défauts catalogués par la caractérisation sont corrigés (PAYMENT_ARCHIVE… × 1, STATUS… × 1, etc.)
    const catalogued = new Set(legacy.knownLegacyDefects.map((d) => d.id));
    for (const id of ["PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE", "PAYMENT_OVERLAPPING_PERIOD_DOUBLES_SALARY", "PAYMENT_ARCHIVE_REVIVES_CANCELLED", "PAYMENT_STATUS_ENDPOINT_NO_STATE_MACHINE", "PAYSLIP_LINES_ROUNDING"]) {
      expect(catalogued.has(id), id).toBe(true);
    }
    void isAppError;
  });
});
