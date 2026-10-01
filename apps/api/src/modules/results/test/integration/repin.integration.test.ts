/**
 * Retard de version de règle et re-pin (AC8.4) : publier une version ne recalcule RIEN ; la vue de période signale le retard ; le re-pin
 * (période ouverte, droit sensible) joint une SIMULATION de l'effet avant de remplacer la version épinglée, puis met un recalcul en file.
 * La « nouvelle version active » est simulée par un port de règles qui change de réponse (la création de versions relève du module rules).
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, noopLogger, unwrap } from "@ecoledigitale/kernel";
import { createResultsDeps, type ResultsDeps } from "../../application/deps";
import { computePeriod } from "../../application/compute";
import { lockPeriod, repinPeriod } from "../../application/lifecycle";
import { getEnrollmentResult, getPeriodView } from "../../application/reads";
import type { ResultsPorts, RuleSession, RulesPort } from "../../application/ports";
import { rulesPortFrom } from "../../infrastructure/rules-adapter";
import type { BatchEvaluator } from "../../domain/pipeline/runner";
import type { EnrollmentRef } from "../../domain/types";
import { adminRows, createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, creditStructure, grade, makeWorld, period, type World } from "../support/world";

const NEW_VERSION_ID = "0190c6a0-0000-7000-8000-00000000f001";
const NEW_HASH = "f".repeat(64);

type ResolvedPin = NonNullable<Extract<Awaited<ReturnType<RulesPort["resolve"]>>, { ok: true }>["value"]>;

describeIntegration("retard de version de règle et re-pin avec simulation (Postgres réel)", () => {
  let db: ResultsTestDb;
  let w: World;
  let deps: ResultsDeps;
  let newVersionActive = false;
  let realPin: ResolvedPin | null = null;
  const classroomId = newId();
  const p = period(newId());
  const built = creditStructure({ classroomId, yearId: newId(), period: p, ues: [{ code: "UE1", ecues: [{ code: "E1", credits: "4" }, { code: "E2", credits: "4" }] }] });
  const id = (c: string): string => built.ids.get(c) as string;
  let students: EnrollmentRef[];
  const ref = { classroomId, academicPeriodId: p.id };

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    const real = rulesPortFrom(w.rulesApi);
    // Version « 2 » simulée : plus exigeante (aucune UE n'est validée) ; évaluée avec les vraies règles de la version 1.
    const stricter = (inner: BatchEvaluator): BatchEvaluator => ({
      run: (calls) => inner.run(calls).map((r, i) => (r.ok && calls[i]?.ruleKey === "ue_validee" ? { ...r, value: false } : r)),
    });
    const port: RulesPort = {
      resolve: async (ctx, request) => {
        const r = await real.resolve(ctx, request);
        if (r.ok && r.value) realPin = r.value;
        if (!r.ok || !r.value || !newVersionActive) return r;
        return { ok: true, value: { ...r.value, ruleVersionId: NEW_VERSION_ID, ruleVersionNo: r.value.ruleVersionNo + 1, definitionHash: NEW_HASH } } as never;
      },
      open: async (ctx, pin) => {
        if (pin.ruleVersionId !== NEW_VERSION_ID) return real.open(ctx, pin);
        const inner = await real.open(ctx, { ...(realPin as ResolvedPin), contractId: pin.contractId });
        if (!inner.ok) return inner;
        const session: RuleSession = { ...inner.value, pin, evaluator: (o) => stricter(inner.value.evaluator(o)) };
        return { ok: true, value: session } as never;
      },
    };
    const ports: ResultsPorts = { curriculum: w.curriculum, roster: w.roster, assess: w.assess, rules: port, guardianship: w.guardianship, names: w.names };
    deps = createResultsDeps({ db: db.tenantDb, clock: w.clock, audit: w.audit, logger: noopLogger, ports });
    w.curriculum.set(built.structure);
    students = Array.from({ length: 3 }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const s of students) w.roster.entries.push({ ...s, active: true, classroomId });
    const pair = (e: EnrollmentRef, node: string, v: string) => [grade(e.enrollmentId, id(node), v), grade(e.enrollmentId, id(node), v, { aggregationGroup: "EXAM" })];
    w.assess.grades = [...pair(students[0]!, "E1", "14"), ...pair(students[0]!, "E2", "13"), ...pair(students[1]!, "E1", "11"), ...pair(students[1]!, "E2", "12"), ...pair(students[2]!, "E1", "6"), ...pair(students[2]!, "E2", "7")];
  });
  afterAll(async () => {
    await db.drop();
  });

  const view = async () => unwrap(await getPeriodView(deps, w.director, { ...ref, caps: CAPS_ALL }));
  const resultOf = async (e: EnrollmentRef) => unwrap(await getEnrollmentResult(deps, w.director, { enrollmentId: e.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL }));

  it("la version active change : RIEN n'est recalculé, la vue de période signale le retard (version épinglée vs active)", async () => {
    unwrap(await computePeriod(deps, w.director, ref));
    expect((await resultOf(students[0]!)).header.validated).toBe(true);
    expect((await view()).ruleLag).toMatchObject({ behind: false, pinned: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1 } });

    newVersionActive = true;
    const lag = (await view()).ruleLag;
    expect(lag).toMatchObject({ behind: true, pinned: { ruleVersionNo: 1 }, active: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 2, definitionHash: NEW_HASH } });
    // un recalcul ordinaire reste sous la version ÉPINGLÉE : mêmes résultats
    const again = unwrap(await computePeriod(deps, w.director, ref));
    expect(again).toMatchObject({ created: 0, unchanged: 3 });
    expect((await view()).state).toMatchObject({ ruleVersionNo: 1 });
  });

  it("re-pin : droit sensible requis ; la SIMULATION jointe annonce l'effet AVANT le remplacement ; un recalcul est mis en file", async () => {
    expect(await repinPeriod(deps, w.director, { ...ref, caps: {} })).toMatchObject({ ok: false, error: { code: "results.forbidden" } });
    const r = unwrap(await repinPeriod(deps, w.director, { ...ref, caps: CAPS_ALL }));
    expect(r.changed).toBe(true);
    expect(r.state).toMatchObject({ ruleVersionNo: 2, ruleVersionId: NEW_VERSION_ID, definitionHash: NEW_HASH });
    expect(r.simulation).toMatchObject({ computed: 3, errors: 0, from: { ruleVersionNo: 1 }, to: { ruleVersionNo: 2 } });
    // étudiants 1 et 2 (UE validée en v1) changent ; l'étudiant 3 (UE déjà non validée) ne change pas
    expect(r.simulation?.changed).toBe(2);
    expect(r.simulation?.unchanged).toBe(1);
    expect(r.simulation?.samples.some((s) => s.field === "validated" && s.before === true && s.after === false)).toBe(true);
    // la simulation n'a rien écrit : les résultats courants sont ceux de la version 1 jusqu'au recalcul
    expect((await resultOf(students[0]!)).header).toMatchObject({ validated: true, ruleVersionNo: 1 });
    const queue = await adminRows(db, "SELECT 1 FROM results.recompute_requests WHERE classroom_id = $1 AND status = 'PENDING'", [classroomId]);
    expect(queue).toHaveLength(1);
    expect((await view()).ruleLag.behind).toBe(false);
    // idempotent : déjà sur la version active
    expect(unwrap(await repinPeriod(deps, w.director, { ...ref, caps: CAPS_ALL }))).toMatchObject({ changed: false, simulation: null });
  });

  it("le recalcul applique la nouvelle version (nouvelles versions DRAFT, version de règle de l'en-tête mise à jour) ; période verrouillée ⇒ re-pin refusé", async () => {
    const report = unwrap(await computePeriod(deps, w.director, ref));
    expect(report.created).toBe(3); // la version de règle de l'en-tête change pour TOUS (même quand les valeurs sont identiques)
    expect((await resultOf(students[0]!)).header).toMatchObject({ validated: false, ruleVersionNo: 2, definitionHash: NEW_HASH, version: 2 });
    unwrap(await lockPeriod(deps, w.director, { ...ref, caps: CAPS_ALL }));
    newVersionActive = false;
    expect(await repinPeriod(deps, w.director, { ...ref, caps: CAPS_ALL })).toMatchObject({ ok: false, error: { code: "results.repin_not_allowed" } });
  });
});
