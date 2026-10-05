/**
 * Intégration (Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL) : modèle de pack idempotent,
 * grille et saisie de compétences en lot idempotente, verrou de période (port PUIS déclencheur SQL), validation, révision tracée,
 * synthèse par compteurs (parité SQL <-> TypeScript), lecture famille.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import type { PrimaryBulkLine } from "@ecoledigitale/contracts/src/v2/primary_school";
import { bulkRecordCompetencies, getCompetencyCounters, listMyClassrooms, getCompetencySheet, getCompetencySummary, getFamilyCompetencySummary, reviseCompetencyAssessment, validateCompetencies } from "../../application/competencies";
import { createFramework, publishFramework, putStructure } from "../../application/frameworks";
import { isPeriodReleasedToFamilies, listPeriodReadiness, markPeriodReady, withdrawPeriodReady } from "../../application/readiness";
import { instantiatePrimaryReferenceData } from "../../application/template";
import { summarizeCompetencies } from "../../domain/competency";
import { insertAssessmentRow, summaryRowsOf } from "../../infrastructure/assessments-repository";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { buildWorld, ctxOf, depsOf, IDS, type World } from "../support/world";

describeIntegration("primary_school : évaluation par compétences (base réelle)", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let w: World;
  let deps: ReturnType<typeof depsOf>["deps"];
  let audit: ReturnType<typeof depsOf>["audit"];
  let frameworkId = "";
  let levels: Array<{ id: string; code: string }> = [];
  let competencies: Array<{ id: string; code: string }> = [];

  const admin = () => ctxOf(tenantA, IDS.admin);
  const teacherA = () => ctxOf(tenantA, IDS.teacherA);
  const teacherB = () => ctxOf(tenantA, IDS.teacherB);
  const TEACHER_CAPS = {};
  const DIRECTION_CAPS = { allClasses: true, councilManage: true, validate: true };
  const lines = (level: string, only?: string[]): PrimaryBulkLine[] =>
    [w.students.s1, w.students.s2, w.students.s3]
      .filter((s) => !only || only.includes(s.enrollmentId))
      .flatMap((s) => competencies.map((c) => ({ enrollmentId: s.enrollmentId, competencyId: c.id, ratingLevelId: level })));
  const lv = (code: string): string => (levels.find((l) => l.code === code) as { id: string }).id;

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("prim-a");
    tenantB = await db.createTenant("prim-b");
    w = buildWorld();
    ({ deps, audit } = depsOf(db.tenantDb, w.world));
    unwrap(await instantiatePrimaryReferenceData(deps, admin(), { institutionId: w.world.institutionId }));
    // Référentiel de test à 3 compétences (2 domaines) applicable aux CE1, publié.
    const scale = unwrap(await (await import("../../application/frameworks")).listScales(deps, admin())).find((s) => s.code === "MASTERY_4");
    const fw = unwrap(await createFramework(deps, admin(), { code: "CE1_TEST", label: "CE1 (test)", scaleId: (scale as { id: string }).id, gradeLevelCodes: ["CE1"], sourceKind: "placeholder" }));
    unwrap(
      await putStructure(deps, admin(), fw.id, {
        domains: [
          { code: "LANG", label: "Langage", competencies: [{ code: "LANG.1", label: "Lire" }, { code: "LANG.2", label: "Écrire" }] },
          { code: "MATH", label: "Mathématiques", competencies: [{ code: "MATH.1", label: "Compter" }] },
        ],
      }),
    );
    const published = unwrap(await publishFramework(deps, admin(), fw.id));
    frameworkId = published.id;
    levels = published.scale.levels.map((l) => ({ id: l.id, code: l.code }));
    competencies = published.domains.flatMap((d) => d.competencies.map((c) => ({ id: c.id, code: c.code })));
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("modèle de pack : un seul passage crée échelle, référentiels publiés, phrases et paramètres ; le rejeu ne change RIEN", async () => {
    const second = unwrap(await instantiatePrimaryReferenceData(deps, admin(), { institutionId: w.world.institutionId }));
    expect(second).toMatchObject({ alreadyApplied: true, created: { scales: 0, frameworks: 0, phrases: 0, settings: 0 } });
    const counts = await db.admin.query(
      `SELECT (SELECT count(*) FROM primary_school.rating_scales WHERE tenant_id = $1)::int AS scales,
              (SELECT count(*) FROM primary_school.competency_frameworks WHERE tenant_id = $1 AND status = 'PUBLISHED' AND source_kind = 'placeholder' AND code LIKE '%\_DEMO')::int AS demo,
              (SELECT count(*) FROM primary_school.appreciation_phrases WHERE tenant_id = $1)::int AS phrases,
              (SELECT count(*) FROM primary_school.settings WHERE tenant_id = $1)::int AS settings,
              (SELECT count(*) FROM primary_school.template_applications WHERE tenant_id = $1)::int AS applications`,
      [tenantA],
    );
    expect(counts.rows[0]).toEqual({ scales: 1, demo: 2, phrases: 3, settings: 1, applications: 1 });
    // Ligne personnalisée : jamais réécrite par une nouvelle application d'une AUTRE version de contenu identique.
    await db.admin.query(`UPDATE primary_school.appreciation_phrases SET body = 'Texte de l''établissement' WHERE tenant_id = $1 AND code = 'PERIOD_N1'`, [tenantA]);
    unwrap(await instantiatePrimaryReferenceData(deps, admin(), { institutionId: w.world.institutionId }));
    const body = (await db.admin.query(`SELECT body FROM primary_school.appreciation_phrases WHERE tenant_id = $1 AND code = 'PERIOD_N1'`, [tenantA])).rows[0].body;
    expect(body).toBe("Texte de l'établissement");
  });

  it("grille : un instituteur voit SA classe (élèves, référentiel applicable, complétude) ; une autre classe est introuvable (404)", async () => {
    const sheet = unwrap(await getCompetencySheet(deps, teacherA(), { classroomId: w.classA, periodId: w.periods[0] as string, frameworkId }, TEACHER_CAPS));
    expect(sheet.students.map((s) => s.displayName)).toEqual(["Awa Koné", "Yao Kouadio", "Fanta Traoré"]);
    expect(sheet.framework?.domains.map((d) => d.code)).toEqual(["LANG", "MATH"]);
    expect(sheet.locked).toBe(false);
    expect(sheet.completeness).toMatchObject({ expected: 9, recorded: 0, validated: 0 });
    // Le référentiel de démonstration CE1 est proposé parmi les référentiels applicables.
    expect(sheet.frameworks.map((f) => f.code).sort()).toEqual(["CE1_TEST", "PRIMARY_DEMO"]);
    const other = await getCompetencySheet(deps, teacherB(), { classroomId: w.classA, periodId: w.periods[0] as string }, TEACHER_CAPS);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.httpStatus).toBe(404);
    unwrap(await getCompetencySheet(deps, ctxOf(tenantA, IDS.secretary), { classroomId: w.classA, periodId: w.periods[0] as string }, DIRECTION_CAPS));
  });

  it("saisie en lot : tout ou rien, idempotente (rejeu = unchanged), rowVersion exigé pour modifier", async () => {
    const p1 = w.periods[0] as string;
    const first = unwrap(await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId, lines: lines(lv("N2")) }, TEACHER_CAPS));
    expect(first).toMatchObject({ created: 9, updated: 0, unchanged: 0 });
    const replay = unwrap(await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId, lines: lines(lv("N2")) }, TEACHER_CAPS));
    expect(replay).toMatchObject({ created: 0, updated: 0, unchanged: 9 });

    // valeur différente SANS rowVersion : refus de tout le lot
    const noVersion = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId, lines: lines(lv("N3"), [w.students.s1.enrollmentId]) }, TEACHER_CAPS);
    expect(noVersion.ok).toBe(false);
    if (!noVersion.ok) expect(noVersion.error.code).toBe("primary_school.row_version_conflict");
    // avec la bonne version : modifiée
    const current = first.assessments.filter((a) => a.enrollmentId === w.students.s1.enrollmentId);
    const patch: PrimaryBulkLine[] = current.map((a) => ({ enrollmentId: a.enrollmentId, competencyId: a.competencyId, ratingLevelId: lv("N3"), rowVersion: a.rowVersion }));
    const updated = unwrap(await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId, lines: patch }, TEACHER_CAPS));
    expect(updated).toMatchObject({ created: 0, updated: 3, unchanged: 0 });
    expect(updated.assessments.every((a) => a.rowVersion === 2)).toBe(true);
    // version périmée : conflit
    const stale = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId, lines: patch.map((l) => ({ ...l, ratingLevelId: lv("N4") })) }, TEACHER_CAPS);
    expect(stale.ok).toBe(false);
  });

  it("saisie : refus tout-ou-rien (élève d'une autre classe, niveau d'une autre échelle, doublon) sans rien écrire", async () => {
    const p2 = w.periods[1] as string;
    const bad: PrimaryBulkLine[] = [...lines(lv("N1"), [w.students.s1.enrollmentId]), { enrollmentId: w.students.b1.enrollmentId, competencyId: (competencies[0] as { id: string }).id, ratingLevelId: lv("N1") }];
    const refused = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p2, frameworkId, lines: bad }, TEACHER_CAPS);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("validation");
    const none = await db.admin.query(`SELECT count(*)::int AS n FROM primary_school.competency_assessments WHERE academic_period_id = $1`, [p2]);
    expect(none.rows[0].n).toBe(0);

    const unknownLevel = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p2, frameworkId, lines: [{ enrollmentId: w.students.s1.enrollmentId, competencyId: (competencies[0] as { id: string }).id, ratingLevelId: "0192f0a4-7b1e-7c3a-8d2e-0000000000ee" }] }, TEACHER_CAPS);
    expect(unknownLevel.ok).toBe(false);
    const dup = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p2, frameworkId, lines: [...lines(lv("N1"), [w.students.s1.enrollmentId]), ...lines(lv("N2"), [w.students.s1.enrollmentId])] }, TEACHER_CAPS);
    expect(dup.ok).toBe(false);
    // un instituteur non affecté ne saisit pas dans la classe (404) ; la direction sans fiche de personnel non plus (trace de l'auteur)
    const notMine = await bulkRecordCompetencies(deps, teacherB(), { classroomId: w.classA, periodId: p2, frameworkId, lines: lines(lv("N1")) }, TEACHER_CAPS);
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.error.httpStatus).toBe(404);
    const noStaff = await bulkRecordCompetencies(deps, admin(), { classroomId: w.classA, periodId: p2, frameworkId, lines: lines(lv("N1")) }, DIRECTION_CAPS);
    expect(noStaff.ok).toBe(false);
    if (!noStaff.ok) expect(noStaff.error.code).toBe("primary_school.staff_profile_required");
  });

  it("verrou de période : refusé par le port (409) ET, si le port était contourné, par le déclencheur SQL", async () => {
    const p3 = w.periods[2] as string;
    w.world.lock(w.classA, p3);
    const viaPort = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p3, frameworkId, lines: lines(lv("N1")) }, TEACHER_CAPS);
    expect(viaPort.ok).toBe(false);
    if (!viaPort.ok) expect(viaPort.error.code).toBe("primary_school.period_locked");
    // contournement direct : le miroir local verrouillé + INSERT sous le rôle applicatif
    await db.admin.query(`INSERT INTO primary_school.period_locks (tenant_id, classroom_id, academic_period_id, status) VALUES ($1,$2,$3,'LOCKED')`, [tenantA, w.classA, p3]);
    await expect(
      db.tenantDb.run(teacherA(), async (tx) => {
        const scaleId = ((await tx.queryOne(`SELECT scale_id FROM primary_school.competency_frameworks WHERE id = $1`, [frameworkId])) as { scale_id: string }).scale_id;
        await insertAssessmentRow(tx, {
          id: "0192f0a4-7b1e-7c3a-8d2e-0000000001e1", tenantId: tenantA, classroomId: w.classA, periodId: p3, enrollmentId: w.students.s1.enrollmentId, studentId: w.students.s1.studentId,
          frameworkId, competencyId: (competencies[0] as { id: string }).id, scaleId, ratingLevelId: lv("N1"), observedOn: "2026-10-02", staffId: w.staffA, note: null,
        });
      }),
    ).rejects.toThrow(/primary_school\.period_locked/);
    w.world.lock(w.classA, p3, false);
    // le port dit « ouvert » : le miroir est réaligné et la saisie passe
    unwrap(await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p3, frameworkId, lines: lines(lv("N1"), [w.students.s1.enrollmentId]) }, TEACHER_CAPS));
  });

  it("validation puis révision tracée : une appréciation validée ne se corrige QUE par une révision (même transaction, motif, audit sensible)", async () => {
    const p1 = w.periods[0] as string;
    const v = unwrap(await validateCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId }, { validate: true }));
    expect(v).toMatchObject({ validated: 9, alreadyValidated: 0, expected: 9, missing: 0 });
    expect(unwrap(await validateCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId }, {}))).toMatchObject({ validated: 0, alreadyValidated: 9 });

    // la saisie ne corrige plus une ligne validée
    const sheet = unwrap(await getCompetencySheet(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId }, TEACHER_CAPS));
    const mathId = (competencies.find((c) => c.code === "MATH.1") as { id: string }).id;
    const target = sheet.assessments.find((a) => a.enrollmentId === w.students.s2.enrollmentId && a.competencyId === mathId) as (typeof sheet.assessments)[number];
    const frozen = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p1, frameworkId, lines: [{ enrollmentId: target.enrollmentId, competencyId: target.competencyId, ratingLevelId: lv("N4"), rowVersion: target.rowVersion }] }, TEACHER_CAPS);
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error.code).toBe("primary_school.validated_frozen");

    // contournement SQL direct sous le rôle applicatif : refusé par le déclencheur (aucune révision dans la transaction)
    await expect(db.tenantDb.run(teacherA(), (tx) => tx.query(`UPDATE primary_school.competency_assessments SET rating_level_id = $2 WHERE id = $1`, [target.id, lv("N4")]))).rejects.toThrow(/validated_frozen/);

    // révision : motif trop court refusé ; motif valide : trace + correction
    const short = await reviseCompetencyAssessment(deps, admin(), target.id, { toRatingLevelId: lv("N4"), reason: "court" }, DIRECTION_CAPS);
    expect(short.ok).toBe(false);
    const done = unwrap(await reviseCompetencyAssessment(deps, admin(), target.id, { toRatingLevelId: lv("N4"), reason: "Erreur de saisie constatée lors du conseil." }, DIRECTION_CAPS));
    expect(done.assessment.ratingLevelId).toBe(lv("N4"));
    expect(done.revision).toMatchObject({ fromLevelId: target.ratingLevelId, toLevelId: lv("N4"), assessmentId: target.id });
    const rev = await db.admin.query(`SELECT count(*)::int AS n FROM primary_school.competency_revisions WHERE assessment_id = $1`, [target.id]);
    expect(rev.rows[0].n).toBe(1);
    const entry = audit.entries.find((e) => e.action === "primary_school.competency.revised");
    expect(entry).toMatchObject({ sensitive: true, resourceId: target.id, reason: "Erreur de saisie constatée lors du conseil." });
    // ni niveau ni appréciation dans l'audit ni dans l'événement
    expect(JSON.stringify(entry)).not.toContain(lv("N4"));
    const ev = await db.admin.query(`SELECT payload FROM kernel.domain_events WHERE type = 'primary_school.competency.revised' AND tenant_id = $1`, [tenantA]);
    expect(ev.rows).toHaveLength(1);
    expect(JSON.stringify(ev.rows[0].payload)).not.toContain(lv("N4"));
    // même niveau : refusé ; la table des révisions est en ajout seul
    const same = await reviseCompetencyAssessment(deps, admin(), target.id, { toRatingLevelId: lv("N4"), reason: "Même niveau demandé deux fois." }, DIRECTION_CAPS);
    expect(same.ok).toBe(false);
    await expect(db.admin.query(`UPDATE primary_school.competency_revisions SET reason = 'modifié modifié modifié'`)).rejects.toThrow(/append_only/);
    await expect(db.admin.query(`DELETE FROM primary_school.competency_revisions`)).rejects.toThrow(/append_only/);
    // période verrouillée : pas de révision (rouvrir d'abord)
    w.world.lock(w.classA, p1);
    const locked = await reviseCompetencyAssessment(deps, admin(), target.id, { toRatingLevelId: lv("N2"), reason: "Tentative sur période verrouillée." }, DIRECTION_CAPS);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe("primary_school.period_locked");
    w.world.lock(w.classA, p1, false);
  });

  it("synthèse : COMPTEURS par domaine et niveau sur les lignes validées, jumeau TypeScript identique à la fonction SQL", async () => {
    const enrollmentId = w.students.s2.enrollmentId;
    const view = unwrap(await getCompetencySummary(deps, teacherA(), { enrollmentId }, TEACHER_CAPS));
    expect(view.summary).toEqual({ LANG: { N2: 2 }, MATH: { N4: 1 } });
    expect(view.levelLabels.N4).toBe("Acquis avec aisance");
    const rows = await db.tenantDb.run(teacherA(), (tx) => summaryRowsOf(tx, enrollmentId, null), { readOnly: true });
    expect(summarizeCompetencies(rows)).toEqual(view.summary);
    // un brouillon (période 3 : une seule ligne non validée) n'entre PAS dans la synthèse
    const s1 = unwrap(await getCompetencySummary(deps, teacherA(), { enrollmentId: w.students.s1.enrollmentId }, TEACHER_CAPS));
    expect(JSON.stringify(s1.summary)).not.toContain("N1");
    // le tenant B ne voit rien (RLS) : même identifiant d'inscription, base commune
    const other = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => summaryRowsOf(tx, enrollmentId, null), { readOnly: true });
    expect(other).toEqual([]);
  });

  it("compteurs pour `results` (decision_fin_annee, competency-period@1) : on COMPTE les compétences distinctes validées contre les attendues, jamais un niveau ; autre tenant : zéros ; classe inconnue : 404", async () => {
    const ids = [w.students.s1, w.students.s2, w.students.s3].map((s) => s.enrollmentId);
    const counters = unwrap(await getCompetencyCounters(deps, teacherA(), { classroomId: w.classA, enrollmentIds: ids }));
    expect([...counters.keys()].sort()).toEqual([...ids].sort());
    const sheet = unwrap(await getCompetencySheet(deps, teacherA(), { classroomId: w.classA, periodId: w.periods[0] as string }, TEACHER_CAPS));
    const expected = (sheet.framework?.domains ?? []).reduce((n, d) => n + d.competencies.length, 0);
    for (const c of counters.values()) {
      expect(Object.keys(c).sort()).toEqual(["evaluated", "expected"]); // deux compteurs, aucune valeur de maîtrise
      expect(c.expected).toBe(expected);
      expect(c.evaluated).toBeLessThanOrEqual(c.expected);
    }
    // l'élève 2 a ses trois compétences du référentiel de test validées (ligne par ligne, périodes confondues : comptées UNE fois)
    if (sheet.framework?.id === frameworkId) expect(counters.get(w.students.s2.enrollmentId)).toEqual({ evaluated: 3, expected: 3 });
    // RLS : un autre tenant ne lit ni les référentiels ni les lignes du tenant A
    const other = unwrap(await getCompetencyCounters(deps, ctxOf(tenantB, IDS.admin), { classroomId: w.classA, enrollmentIds: ids }));
    for (const c of other.values()) expect(c).toEqual({ evaluated: 0, expected: 0 });
    expect((await getCompetencyCounters(deps, teacherA(), { classroomId: "0192f0a4-7b1e-7c3a-8d2e-00000000dead", enrollmentIds: ids })).ok).toBe(false);
  });

  it("famille (Q-P18) : le parent voit une période APRÈS validation de la grille (ou « prêts », ou bulletin publié), jamais un brouillon, et seulement pour son enfant", async () => {
    const e1 = w.students.s1.enrollmentId;
    // période 1 : grille validée -> visible sans bulletin publié ; période 3 : un brouillon -> invisible ; période 2 : aucune ligne
    const before = unwrap(await getFamilyCompetencySummary(deps, ctxOf(tenantA, IDS.parent1), { studentId: null, enrollmentId: e1 }));
    expect(before.periodIds).toEqual([w.periods[0]]);
    expect(JSON.stringify(before.summary)).not.toContain("N1"); // le brouillon de la période 3 (niveau N1) n'apparaît pas
    w.world.publishedPeriods.set(e1, [w.periods[0] as string]);
    const after = unwrap(await getFamilyCompetencySummary(deps, ctxOf(tenantA, IDS.parent1), { studentId: null, enrollmentId: e1 }));
    expect(after.periodIds).toEqual([w.periods[0]]);
    expect(Object.keys(after.summary).sort()).toEqual(["LANG", "MATH"]);
    // un parent non lié : introuvable (404), pas de fuite d'existence
    const intruder = await getFamilyCompetencySummary(deps, ctxOf(tenantA, IDS.parent2), { studentId: null, enrollmentId: e1 });
    expect(intruder.ok).toBe(false);
    if (!intruder.ok) expect(intruder.error.httpStatus).toBe(404);
    // un tuteur demande une période ni prête, ni validée, ni publiée (brouillon seulement) : rien
    const draftOnly = unwrap(await getFamilyCompetencySummary(deps, ctxOf(tenantA, IDS.parent1), { studentId: null, enrollmentId: e1, periodIds: [w.periods[2] as string] }));
    expect(draftOnly).toMatchObject({ periodIds: [], summary: {} });
    const unpublished = unwrap(await getFamilyCompetencySummary(deps, ctxOf(tenantA, IDS.parent1), { studentId: null, enrollmentId: e1, periodIds: [w.periods[1] as string] }));
    expect(unpublished.summary).toEqual({});
  });

  it("Q-P18 « prêts » : action d'enseignant auditée, saisie gelée, visible des familles, réversible tant que non publié, RLS A/B", async () => {
    const e1 = w.students.s1.enrollmentId;
    const p3 = w.periods[2] as string; // trois brouillons (niveau N1) de l'élève 1
    const parent = ctxOf(tenantA, IDS.parent1);
    const familyView = async () => unwrap(await getFamilyCompetencySummary(deps, parent, { studentId: null, enrollmentId: e1, periodIds: [p3] }));
    const eventsOf = async (type: string) => (await db.admin.query(`SELECT payload FROM kernel.domain_events WHERE type = $1 AND tenant_id = $2`, [type, tenantA])).rows;

    // avant : brouillon invisible, état « prêt » faux partout
    expect(await familyView()).toMatchObject({ periodIds: [], summary: {} });
    expect(unwrap(await isPeriodReleasedToFamilies(deps, teacherA(), { classroomId: w.classA, periodId: p3 }))).toBe(false);
    const mine = unwrap(await listMyClassrooms(deps, teacherA(), TEACHER_CAPS));
    expect(mine.flatMap((c) => c.periods).every((p) => p.ready === false)).toBe(true);

    // un instituteur non affecté : 404 ; une période inconnue : refus de forme
    const notMine = await markPeriodReady(deps, teacherB(), { classroomId: w.classA, periodId: p3 }, TEACHER_CAPS);
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.error.httpStatus).toBe(404);
    expect((await markPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: "0192f0a4-7b1e-7c3a-8d2e-00000000dead" }, TEACHER_CAPS)).ok).toBe(false);
    expect(await eventsOf("primary_school.period.marked_ready")).toHaveLength(0);

    // marquer prêts : audité (identifiants et comptages, jamais de niveau), un événement ; idempotent
    const ready = unwrap(await markPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3 }, TEACHER_CAPS));
    expect(ready).toMatchObject({ classroomId: w.classA, periodId: p3, status: "READY" });
    unwrap(await markPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3 }, TEACHER_CAPS));
    const marked = await eventsOf("primary_school.period.marked_ready");
    expect(marked).toHaveLength(1);
    expect(marked[0].payload).toEqual({ v: 1, classroomId: w.classA, periodId: p3 });
    const entry = audit.entries.find((e) => e.action === "primary_school.period.marked_ready");
    expect(entry).toMatchObject({ resourceType: "classroom_period", metadata: { classroomId: w.classA, periodId: p3, draftCount: 3, validatedCount: 0 } });
    expect(JSON.stringify(entry)).not.toContain(lv("N1"));
    expect(unwrap(await isPeriodReleasedToFamilies(deps, teacherA(), { classroomId: w.classA, periodId: p3 }))).toBe(true);
    expect(unwrap(await listPeriodReadiness(deps, teacherA(), w.classA, TEACHER_CAPS)).map((r) => [r.periodId, r.status])).toEqual([[p3, "READY"]]);
    const mineReady = unwrap(await listMyClassrooms(deps, teacherA(), TEACHER_CAPS)).flatMap((c) => c.periods);
    expect(mineReady.filter((p) => p.ready).map((p) => p.id)).toEqual([p3]);

    // la famille voit désormais la période (ce que l'enseignant a déclaré prêt) ; un autre tuteur : 404
    expect((await familyView()).summary).toEqual({ LANG: { N1: 2 }, MATH: { N1: 1 } });
    expect((await getFamilyCompetencySummary(deps, ctxOf(tenantA, IDS.parent2), { studentId: null, enrollmentId: e1, periodIds: [p3] })).ok).toBe(false);

    // la saisie est gelée : refus applicatif (409) ET, si le chemin était contourné, refus du déclencheur SQL
    const frozen = await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p3, frameworkId, lines: lines(lv("N2"), [w.students.s1.enrollmentId]) }, TEACHER_CAPS);
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error.code).toBe("primary_school.period_ready");
    await expect(
      db.tenantDb.run(teacherA(), (tx) => tx.query(`UPDATE primary_school.competency_assessments SET rating_level_id = $2 WHERE classroom_id = $1 AND academic_period_id = $3`, [w.classA, lv("N3"), p3])),
    ).rejects.toThrow(/period_ready/);

    // retrait : motif obligatoire ; refusé si un bulletin de la période est publié aux familles
    const short = await withdrawPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3, reason: "court" }, TEACHER_CAPS);
    expect(short.ok).toBe(false);
    w.world.publishedPeriods.set(e1, [w.periods[0] as string, p3]);
    const published = await withdrawPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3, reason: "Marquage posé par erreur hier." }, TEACHER_CAPS);
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.error.code).toBe("primary_school.period_published");
    w.world.publishedPeriods.set(e1, [w.periods[0] as string]);
    // RLS A/B : le tenant B ne voit aucun état « prêt »
    const otherRows = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => tx.many(`SELECT * FROM primary_school.period_readiness`), { readOnly: true });
    expect(otherRows).toEqual([]);

    const withdrawn = unwrap(await withdrawPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3, reason: "Marquage posé par erreur hier." }, TEACHER_CAPS));
    expect(withdrawn).toMatchObject({ status: "NOT_READY" });
    expect(await eventsOf("primary_school.period.ready_withdrawn")).toHaveLength(1);
    expect(audit.entries.find((e) => e.action === "primary_school.period.ready_withdrawn")).toMatchObject({ reason: "Marquage posé par erreur hier." });
    expect(unwrap(await isPeriodReleasedToFamilies(deps, teacherA(), { classroomId: w.classA, periodId: p3 }))).toBe(false);
    // retirer deux fois : conflit ; le brouillon redevient invisible ; la saisie redevient possible
    expect((await withdrawPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3, reason: "Marquage posé par erreur hier." }, TEACHER_CAPS)).ok).toBe(false);
    expect(await familyView()).toMatchObject({ periodIds: [], summary: {} });
    unwrap(await bulkRecordCompetencies(deps, teacherA(), { classroomId: w.classA, periodId: p3, frameworkId, lines: lines(lv("N2"), [w.students.s2.enrollmentId]) }, TEACHER_CAPS));
    // re-marquer prêts après un retrait : possible (nouvel événement)
    unwrap(await markPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3 }, TEACHER_CAPS));
    expect(await eventsOf("primary_school.period.marked_ready")).toHaveLength(2);
    unwrap(await withdrawPeriodReady(deps, teacherA(), { classroomId: w.classA, periodId: p3, reason: "Retrait de fin de test." }, TEACHER_CAPS));
  });

  it("isolation tenant : les données du tenant A sont invisibles du tenant B", async () => {
    const rows = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => tx.many(`SELECT id FROM primary_school.competency_assessments`), { readOnly: true });
    expect(rows).toEqual([]);
    const counts = await db.tenantDb.run(ctxOf(tenantB, IDS.admin), (tx) => tx.queryOne(`SELECT (SELECT count(*) FROM primary_school.competency_frameworks)::int AS f, (SELECT count(*) FROM primary_school.rating_scales)::int AS s`), { readOnly: true });
    expect(counts).toEqual({ f: 0, s: 0 });
  });
});
