/** Référentiels / modèles de pack (US8, critère 2) et curriculum polymorphe versionné (US2). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  addCurriculumNode,
  amendPublishedCurriculum,
  cloneCurriculumVersion,
  createAcademicYear,
  createCurriculumVersion,
  createProgram,
  createSubject,
  deleteSubject,
  getCurriculumTree,
  getNodePrerequisiteStatus,
  getAcademicSettings,
  instantiatePackReferenceData,
  listCurriculumAmendments,
  listCurriculumVersions,
  listReference,
  moveCurriculumNode,
  publishCurriculumVersion,
  putReference,
  removeCurriculumNode,
  setNodePrerequisites,
  setProgramGradeLevels,
  updateAcademicSettings,
  updateCurriculumNode,
  validateCurriculumVersion,
  InMemoryStudentDirectory,
} from "../../index";
import { adminOne, adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { FakeCompletion, nothingInUse, usedNodes } from "../support/ports";
import { assertEventsValid, codeOf, createNextYear, eventsOf, makeWorld, seedHigher, type World } from "../support/world";
import { RecordingAudit } from "../../index";

describeIntegration("référentiels, modèles de pack et curriculum (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });
  const newWorld = async (ports = {}): Promise<World> => makeWorld(db, await db.createTenant(), { ports });
  /** Année contiguë à la dernière année de l'établissement du monde. */
  const chainYear = async (w: World, code: string) => {
    const last = await adminOne<{ e: string }>(db, "SELECT to_char(max(ends_on), 'YYYY-MM-DD') e FROM academic.academic_years WHERE tenant_id = $1 AND institution_id = $2", [w.tenantId, w.institutionId]);
    return createNextYear(w, last.e, code);
  };

  describe("modèles de pack : un tenant provisionné reçoit ses référentiels sans développeur", () => {
    it.each([
      ["PRIMARY", "CP1", ["MATERNELLE", "PRIMAIRE"]],
      ["SECONDARY", "TLE", ["COLLEGE", "LYCEE"]],
      ["HIGHER", "M2", []],
      ["VIRTUAL", null, []],
    ] as const)("pack %s", async (pack, grade, programs) => {
      const w = await newWorld();
      const r = unwrap(await instantiatePackReferenceData(w.deps, w.ctx, w.institutionId, { pack, educationSystem: "CI" }));
      expect(r).toMatchObject({ pack, educationSystem: "CI", alreadyApplied: false, customizedKept: [] });
      expect(r.created.nodeTypes).toBe(6);
      const grades = unwrap(await listReference(w.deps, w.ctx, "grade-levels"));
      if (grade) expect(grades.map((g) => g.code)).toContain(grade);
      else expect(grades).toEqual([]);
      const types = unwrap(await listReference(w.deps, w.ctx, "node-types"));
      expect(types.map((t) => t.code)).toEqual(["LEVEL", "PERIOD", "GROUP", "UE", "ECUE", "SUBJECT"]);
      expect(types.every((t) => t.isSystem)).toBe(true);
      const prog = await adminRows<{ code: string }>(db, "SELECT code FROM academic.programs WHERE tenant_id = $1 ORDER BY code", [w.tenantId]);
      expect(prog.map((p) => p.code)).toEqual([...programs]);
      // chaîne de niveaux : la donnée `next` est résolue en identifiants
      if (pack === "HIGHER") {
        const l1 = grades.find((g) => g.code === "L1")!;
        expect(grades.find((g) => g.id === l1.nextGradeLevelId)?.code).toBe("L2");
        expect(grades.find((g) => g.code === "L3")).toMatchObject({ isFinal: true, nextGradeLevelId: null });
      }
      const settings = unwrap(await getAcademicSettings(w.deps, w.ctx, w.institutionId));
      expect(settings.enrollmentConfirmationPolicy).toBe(pack === "HIGHER" ? "ON_REGISTRATION_FEE_PAID" : "AUTO");
    });
    it("idempotent : ré-appliquer ne duplique rien ; une ligne PERSONNALISÉE par le tenant est conservée et rapportée", async () => {
      const w = await newWorld();
      unwrap(await instantiatePackReferenceData(w.deps, w.ctx, w.institutionId, { pack: "HIGHER", educationSystem: "CI" }));
      const count = async () => (await adminOne<{ n: number }>(db, "SELECT (SELECT count(*) FROM academic.grade_levels WHERE tenant_id=$1) + (SELECT count(*) FROM academic.period_types WHERE tenant_id=$1) + (SELECT count(*) FROM academic.funding_types WHERE tenant_id=$1) AS n", [w.tenantId])).n;
      const before = Number(await count());
      // le tenant renomme un cycle, de façon durable (updated_at > created_at)
      await db.admin.query("UPDATE academic.education_levels SET label = 'Cycle Licence maison', updated_at = created_at + interval '1 hour' WHERE tenant_id = $1 AND code = 'LICENCE'", [w.tenantId]);
      const again = unwrap(await instantiatePackReferenceData(w.deps, w.ctx, w.institutionId, { pack: "HIGHER", educationSystem: "CI" }));
      expect(again.alreadyApplied).toBe(true);
      expect(again.created).toEqual({});
      expect(again.customizedKept).toEqual(["educationLevels:LICENCE"]);
      expect(Number(await count())).toBe(before);
      expect((await adminOne<{ label: string }>(db, "SELECT label FROM academic.education_levels WHERE tenant_id = $1 AND code = 'LICENCE'", [w.tenantId])).label).toBe("Cycle Licence maison");
      expect((w.audit as RecordingAudit).actions().filter((a) => a === "academic.template.applied")).toHaveLength(2);
      expect((w.audit as RecordingAudit).entries[0]!.entry.sensitive).toBe(true);
    });
    it("deux packs sur deux établissements du même tenant se complètent ; pack ou système inconnu : erreur claire", async () => {
      const w = await newWorld();
      unwrap(await instantiatePackReferenceData(w.deps, w.ctx, w.institutionId, { pack: "PRIMARY", educationSystem: "CI" }));
      unwrap(await instantiatePackReferenceData(w.deps, w.ctx, newId(), { pack: "SECONDARY", educationSystem: "CI" }));
      const grades = unwrap(await listReference(w.deps, w.ctx, "grade-levels"));
      expect(grades.map((g) => g.code)).toEqual(expect.arrayContaining(["CP1", "6E", "TLE"]));
      expect(codeOf(await instantiatePackReferenceData(w.deps, w.ctx, newId(), { pack: "HIGHER", educationSystem: "ZZ" }))).toBe("academic.template_unknown");
      expect(codeOf(await instantiatePackReferenceData(w.deps, w.ctx, newId()))).toBe("academic.template_unknown"); // ni pack ni système
    });
    it("modification des référentiels par le tenant (par code) ; types système intouchables ; grammaire ajoutable sans code", async () => {
      const w = await newWorld();
      unwrap(await instantiatePackReferenceData(w.deps, w.ctx, w.institutionId, { pack: "HIGHER", educationSystem: "CI" }));
      expect(unwrap(await putReference(w.deps, w.ctx, "period-types", [{ code: "QUADRIMESTER", label: "Quadrimestre", kind: "TEACHING_PERIOD" }]))).toEqual({ created: 1, updated: 0 });
      expect(unwrap(await putReference(w.deps, w.ctx, "period-types", [{ code: "QUADRIMESTER", label: "Quadrimestre 2026", kind: "TEACHING_PERIOD" }]))).toEqual({ created: 0, updated: 1 });
      expect(unwrap(await putReference(w.deps, w.ctx, "period-plans", [{ code: "FOUR", label: "Quatre", slots: [1, 2, 3, 4].map((n) => ({ type: "QUADRIMESTER", ordinal: n, label: `Q${n}` })) }])).created).toBe(1);
      expect(codeOf(await putReference(w.deps, w.ctx, "period-plans", [{ code: "BAD", label: "x", slots: [{ type: "INCONNU", ordinal: 1, label: "x" }] }]))).toBe("academic.period_type_unknown");
      expect(codeOf(await putReference(w.deps, w.ctx, "node-types", [{ code: "UE", label: "Pirate", allowedParentCodes: ["ROOT"] }]))).toBe("academic.reference_system_locked");
      expect(unwrap(await putReference(w.deps, w.ctx, "node-types", [{ code: "MODULE", label: "Module", allowedParentCodes: ["LEVEL"], allowsCredits: true }])).created).toBe(1);
      expect(unwrap(await putReference(w.deps, w.ctx, "grade-levels", [{ code: "L4", label: "Licence 4", educationLevelCode: "LICENCE", ordinal: 4, nextGradeLevelCode: "M1" }])).created).toBe(1);
      expect(codeOf(await putReference(w.deps, w.ctx, "grade-levels", [{ code: "L5", label: "x", educationLevelCode: "INCONNU", ordinal: 5 }]))).toBe("academic.education_level_not_found");
      expect(codeOf(await putReference(w.deps, w.ctx, "grade-levels", [{ code: "L5", label: "x", educationLevelCode: "LICENCE", ordinal: 5, nextGradeLevelCode: "NOPE" }]))).toBe("academic.grade_level_not_found");
      expect(unwrap(await putReference(w.deps, w.ctx, "enrollment-outcomes", [{ code: "DEFERRED", label: "Ajourné", kind: "REPEAT" }])).created).toBe(1);
      expect(unwrap(await putReference(w.deps, w.ctx, "funding-types", [{ code: "STATE_ASSIGNED", label: "Affecté (maison)", requiresReference: true }])).updated).toBe(1);
      expect(unwrap(await putReference(w.deps, w.ctx, "education-levels", [{ code: "DOCTORAT", label: "Doctorat", ordinal: 13, pack: "HIGHER" }])).created).toBe(1);
    });
    it("paramètres d'établissement : politique, durée de réservation, motif du numéro d'inscription validé", async () => {
      const w = await newWorld();
      expect(unwrap(await getAcademicSettings(w.deps, w.ctx, w.institutionId))).toMatchObject({ enrollmentConfirmationPolicy: "AUTO", courseConfirmationPolicy: "ON_LINE_PAID", pendingHoldMinutes: null });
      const s = unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "MANUAL", pendingHoldMinutes: 30, registrationNumberPrefix: "ECO", registrationNumberPattern: "{PREFIX}-{PROGRAM}-{STUDENT_SEQ:4}" }));
      expect(s).toMatchObject({ enrollmentConfirmationPolicy: "MANUAL", pendingHoldMinutes: 30, registrationNumberPrefix: "ECO" });
      expect(codeOf(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { registrationNumberPattern: "{PROGRAM}" }))).toBe("academic.registration_pattern_invalid");
      expect(codeOf(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { registrationNumberPrefix: null }))).toBe("academic.registration_pattern_invalid"); // {PREFIX} sans préfixe
      expect(unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { pendingHoldMinutes: null })).pendingHoldMinutes).toBeNull();
    });
  });

  describe("curriculum polymorphe (AC2.1 – AC2.7)", () => {
    it("un programme PRIMAIRE (LEVEL > SUBJECT) et un programme SUPÉRIEUR (LEVEL > PERIOD > UE > ECUE) se publient par le MÊME code et les MÊMES tables", async () => {
      const w = await newWorld();
      const h = await seedHigher(w); // supérieur, publié
      unwrap(await instantiatePackReferenceData(w.deps, w.ctx, newId(), { pack: "PRIMARY", educationSystem: "CI" }));
      const inst = newId();
      const grades = unwrap(await listReference(w.deps, w.ctx, "grade-levels"));
      const cp1 = grades.find((g) => g.code === "CP1")!;
      const levels = unwrap(await listReference(w.deps, w.ctx, "education-levels"));
      const year = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: inst, code: "P", label: "P", startsOn: "2026-09-01" }));
      const program = unwrap(await createProgram(w.deps, w.ctx, { institutionId: inst, educationLevelId: levels.find((l) => l.code === "PRIMARY")!.id, code: "PRIM", label: "Primaire", gradeLevelIds: [cp1.id] }));
      const lecture = unwrap(await createSubject(w.deps, w.ctx, { institutionId: inst, code: "LECT", label: "Lecture" }));
      const calcul = unwrap(await createSubject(w.deps, w.ctx, { institutionId: inst, code: "CALC", label: "Calcul" }));
      const v = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: program.id, academicYearId: year.id }));
      const level = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { nodeTypeCode: "LEVEL", code: "CP1", label: "CP1", gradeLevelId: cp1.id }));
      unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: level.id, nodeTypeCode: "SUBJECT", code: "LECT", label: "Lecture", subjectId: lecture.id, coefficient: 2 }));
      unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: level.id, nodeTypeCode: "SUBJECT", code: "CALC", label: "Calcul", subjectId: calcul.id, coefficient: "3.5" }));
      const published = unwrap(await publishCurriculumVersion(w.deps, w.ctx, v.id));
      expect(published.status).toBe("PUBLISHED");
      const tree = unwrap(await getCurriculumTree(w.deps, w.ctx, { versionId: v.id }));
      expect(tree.roots).toHaveLength(1);
      expect(tree.roots[0]!.children.map((c) => [c.code, c.coefficient, c.credits])).toEqual([["LECT", "2", null], ["CALC", "3.5", null]]);
      const higher = unwrap(await getCurriculumTree(w.deps, w.ctx, { versionId: h.versionId }));
      expect(higher.roots[0]!.children[0]!.children[0]!.children.map((c) => c.code)).toEqual(["E11", "E12"]);
      const sameTable = await adminOne<{ n: number }>(db, "SELECT count(DISTINCT version_id)::int n FROM academic.curriculum_nodes WHERE tenant_id = $1", [w.tenantId]);
      expect(sameTable.n).toBe(2);
    });

    it("la grammaire est imposée aux cas d'usage AVANT la base (codes stables) : ECUE sous LEVEL, SUBJECT sans matière, crédits sur GROUP, déplacement cyclique", async () => {
      const w = await newWorld();
      const h = await seedHigher(w);
      const y2 = await chainYear(w, "N");
      const v = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: h.programId, academicYearId: y2.id }));
      const level = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { nodeTypeCode: "LEVEL", code: "L1", label: "L1", gradeLevelId: h.gradeLevelId }));
      const add = (b: Record<string, unknown>) => addCurriculumNode(w.deps, w.ctx, v.id, { label: "x", ...b } as never);
      expect(codeOf(await add({ nodeTypeCode: "ECUE", code: "A", parentId: level.id, subjectId: h.subjectIds[0] }))).toBe("academic.node_bad_parent");
      expect(codeOf(await add({ nodeTypeCode: "SUBJECT", code: "B", parentId: level.id }))).toBe("academic.node_subject_required");
      expect(codeOf(await add({ nodeTypeCode: "GROUP", code: "C", parentId: level.id, credits: 2 }))).toBe("academic.node_credits_forbidden");
      expect(codeOf(await add({ nodeTypeCode: "GROUP", code: "D", parentId: null }))).toBe("academic.node_needs_parent");
      expect(codeOf(await add({ nodeTypeCode: "LEVEL", code: "E", parentId: null }))).toBe("academic.node_grade_level_required");
      expect(codeOf(await add({ nodeTypeCode: "PERIOD", code: "F", parentId: level.id }))).toBe("academic.node_period_slot_required");
      expect(codeOf(await add({ nodeTypeCode: "INCONNU", code: "G", parentId: level.id }))).toBe("academic.node_type_unknown");
      expect(codeOf(await add({ nodeTypeCode: "GROUP", code: "H", parentId: newId() }))).toBe("academic.node_not_found");
      expect(codeOf(await add({ nodeTypeCode: "SUBJECT", code: "I", parentId: level.id, subjectId: h.subjectIds[0], coefficient: 0 }))).toBe("academic.invalid_input");
      expect(codeOf(await add({ nodeTypeCode: "SUBJECT", code: "J", parentId: level.id, subjectId: h.subjectIds[0], coefficient: 123456 }))).toBe("academic.invalid_input");
      expect(codeOf(await add({ nodeTypeCode: "SUBJECT", code: "K", parentId: level.id, subjectId: h.subjectIds[0], coefficient: "abc" }))).toBe("academic.invalid_input");
      const g1 = unwrap(await add({ nodeTypeCode: "GROUP", code: "G1", parentId: level.id }));
      expect(codeOf(await moveCurriculumNode(w.deps, w.ctx, level.id, { parentId: g1.id }))).toBe("academic.node_cycle");
      expect(codeOf(await moveCurriculumNode(w.deps, w.ctx, level.id, { parentId: level.id }))).toBe("academic.node_cycle");
      expect(codeOf(await moveCurriculumNode(w.deps, w.ctx, g1.id, { parentId: null }))).toBe("academic.node_needs_parent");
      const s = unwrap(await add({ nodeTypeCode: "SUBJECT", code: "S1", parentId: g1.id, subjectId: h.subjectIds[0] }));
      expect(unwrap(await moveCurriculumNode(w.deps, w.ctx, s.id, { parentId: level.id, ordinal: 5 }))).toMatchObject({ parentId: level.id, ordinal: 5 });
      expect(unwrap(await updateCurriculumNode(w.deps, w.ctx, s.id, { coefficient: "2.250", label: "Libellé" }))).toMatchObject({ coefficient: "2.25", label: "Libellé" });
      expect(codeOf(await updateCurriculumNode(w.deps, w.ctx, s.id, { subjectId: null }))).toBe("academic.node_subject_required");
      expect(unwrap(await removeCurriculumNode(w.deps, w.ctx, g1.id))).toEqual({ removed: 1 });
    });

    it("rapport de validation complet ; publier avec une ERREUR est refusé ; crédits d'UE ≠ Σ ECUE", async () => {
      const w = await newWorld();
      const h = await seedHigher(w);
      const y2 = await chainYear(w, "N");
      const v = unwrap(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: h.versionId, targetAcademicYearId: y2.id }));
      const tree = unwrap(await getCurriculumTree(w.deps, w.ctx, { versionId: v.id }));
      const ue1 = tree.roots[0]!.children[0]!.children[0]!;
      unwrap(await updateCurriculumNode(w.deps, w.ctx, ue1.id, { credits: 9 }));
      const report = unwrap(await validateCurriculumVersion(w.deps, w.ctx, v.id));
      expect(report.valid).toBe(false);
      expect(report.issues.find((i) => i.code === "academic.credits_mismatch")).toMatchObject({ severity: "ERROR", nodeId: ue1.id });
      const refused = await publishCurriculumVersion(w.deps, w.ctx, v.id);
      expect(codeOf(refused)).toBe("academic.curriculum_invalid");
      expect(!refused.ok && (refused.error.details?.report as { errors: number }).errors).toBe(1);
      unwrap(await updateCurriculumNode(w.deps, w.ctx, ue1.id, { credits: 6 }));
      expect(unwrap(await validateCurriculumVersion(w.deps, w.ctx, v.id)).valid).toBe(true);
      expect(unwrap(await publishCurriculumVersion(w.deps, w.ctx, v.id)).status).toBe("PUBLISHED");
      expect(codeOf(await publishCurriculumVersion(w.deps, w.ctx, v.id))).toBe("academic.version_transition");
    });

    it("clonage annuel : DRAFT, mêmes lignées, nouveaux identifiants, prérequis recréés (AC2.4) ; une seule version par (programme, année)", async () => {
      const w = await newWorld();
      const h = await seedHigher(w);
      // prérequis de la lignée UE2 sur UE1, posé dans un brouillon puis publié -> la source du clone
      const y2 = await chainYear(w, "N");
      const draft = unwrap(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: h.versionId, targetAcademicYearId: y2.id, note: "reconduction" }));
      expect(draft).toMatchObject({ status: "DRAFT", clonedFromVersionId: h.versionId, nodeCount: 8 });
      const src = await adminRows<{ id: string; lineage_id: string; code: string }>(db, "SELECT id, lineage_id, code FROM academic.curriculum_nodes WHERE version_id = $1 ORDER BY code", [h.versionId]);
      const dst = await adminRows<{ id: string; lineage_id: string; code: string }>(db, "SELECT id, lineage_id, code FROM academic.curriculum_nodes WHERE version_id = $1 ORDER BY code", [draft.id]);
      expect(dst.map((n) => n.code)).toEqual(src.map((n) => n.code));
      expect(dst.map((n) => n.lineage_id)).toEqual(src.map((n) => n.lineage_id)); // lignées conservées
      expect(dst.every((n, i) => n.id !== src[i]!.id)).toBe(true); // identifiants neufs
      const ue2Dst = dst.find((n) => n.code === "UE2")!;
      unwrap(await setNodePrerequisites(w.deps, w.ctx, ue2Dst.id, [src.find((n) => n.code === "UE1")!.lineage_id]));
      const y3 = await chainYear(w, "N3");
      const third = unwrap(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: draft.id, targetAcademicYearId: y3.id }));
      const prereqs = await adminRows<{ node_id: string; required_lineage_id: string }>(db, "SELECT node_id, required_lineage_id FROM academic.curriculum_prerequisites WHERE version_id = $1", [third.id]);
      const ue2Third = (await adminOne<{ id: string }>(db, "SELECT id FROM academic.curriculum_nodes WHERE version_id = $1 AND code = 'UE2'", [third.id])).id;
      expect(prereqs).toEqual([{ node_id: ue2Third, required_lineage_id: src.find((n) => n.code === "UE1")!.lineage_id }]);
      expect(codeOf(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: h.versionId, targetAcademicYearId: y2.id }))).toBe("academic.curriculum_exists");
      expect(codeOf(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: h.versionId, targetAcademicYearId: h.yearId }))).toBe("academic.curriculum_exists");
      expect(unwrap(await listCurriculumVersions(w.deps, w.ctx, { programId: h.programId }))).toHaveLength(3);
    });

    it("3 000 nœuds clonés rapidement (objectif < 2 s en CI de performance)", async () => {
      const w = await newWorld();
      const h = await seedHigher(w);
      const y2 = await chainYear(w, "BIG");
      const big = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: h.programId, academicYearId: y2.id }));
      // 3 000 ECUE insérés en SQL (le chargement n'est pas ce qu'on mesure)
      await db.admin.query(
        `INSERT INTO academic.curriculum_nodes (id, tenant_id, version_id, parent_id, node_type_code, lineage_id, subject_id, grade_level_id, code, label)
         SELECT gen_random_uuid(), $1, $2, NULL, 'LEVEL', gen_random_uuid(), NULL, $3, 'L1', 'L1'`,
        [w.tenantId, big.id, h.gradeLevelId],
      );
      const lvl = (await adminOne<{ id: string }>(db, "SELECT id FROM academic.curriculum_nodes WHERE version_id = $1", [big.id])).id;
      await db.admin.query(
        `INSERT INTO academic.curriculum_nodes (id, tenant_id, version_id, parent_id, node_type_code, lineage_id, subject_id, code, label, coefficient)
         SELECT gen_random_uuid(), $1, $2, $3, 'SUBJECT', gen_random_uuid(), $4, 'S' || g, 'Matière ' || g, 1 FROM generate_series(1, 2999) g`,
        [w.tenantId, big.id, lvl, h.subjectIds[0]],
      );
      const y3 = await chainYear(w, "BIG2");
      const t0 = Date.now();
      const clone = unwrap(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: big.id, targetAcademicYearId: y3.id }));
      const elapsed = Date.now() - t0;
      expect(clone.nodeCount).toBe(3000);
      console.info(`[perf] clone de 3 000 nœuds : ${elapsed} ms`);
      // Garde-fou LÂCHE contre une régression d'ordre de grandeur (aller-retour par nœud, O(n²)). Le coût est
      // dominé par les déclencheurs de contrainte par ligne (≈ 0,7 ms/ligne au repos, > 4 ms quand la machine
      // exécute d'autres bases) : l'objectif de 2 s (AC2.4) est mesuré par la CI de performance dédiée, pas ici.
      expect(elapsed).toBeLessThan(30_000);
      const t1 = Date.now();
      const tree = unwrap(await getCurriculumTree(w.deps, w.ctx, { versionId: clone.id }));
      console.info(`[perf] getCurriculumTree de 3 000 nœuds : ${Date.now() - t1} ms`);
      expect(tree.roots[0]!.children).toHaveLength(2999);
    });

    it("version publiée : structure gelée, amendement motivé journalisé, CurriculumUsageGuard, validation après amendement (AC2.5)", async () => {
      const guard = usedNodes([]);
      const w = await newWorld({ usageGuard: guard });
      const h = await seedHigher(w);
      const [e11, e12] = h.ue1.ecueIds;
      expect((await addCurriculumNode(w.deps, w.ctx, h.versionId, { nodeTypeCode: "ECUE", code: "N", label: "n", parentId: h.ue1.id, subjectId: h.subjectIds[2]! })).ok).toBe(false);
      expect(codeOf(await updateCurriculumNode(w.deps, w.ctx, e11!, { coefficient: 3 }))).toBe("academic.curriculum_published");
      expect(codeOf(await removeCurriculumNode(w.deps, w.ctx, e11!))).toBe("academic.curriculum_published");
      expect(codeOf(await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "abc", operations: [{ op: "UPDATE_NODE", nodeId: e11!, patch: { coefficient: 3 } }] }))).toBe("academic.amendment_reason_required");
      // coefficient : amendement numérique
      const r = unwrap(
        await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Arrêté de rectification des coefficients", operations: [{ op: "UPDATE_NODE", nodeId: e11!, patch: { coefficient: "2.5" } }] }),
      );
      expect(r.amendments).toBe(1);
      const list = unwrap(await listCurriculumAmendments(w.deps, w.ctx, h.versionId));
      expect(list[0]).toMatchObject({ kind: "COEFFICIENT", nodeId: e11, oldValue: { coefficient: "2" }, newValue: { coefficient: "2.5" }, reason: "Arrêté de rectification des coefficients", amendedBy: w.ctx.userId });
      // crédits d'une ECUE sans l'UE : le curriculum deviendrait invalide -> rollback complet
      const bad = await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Erreur volontaire de crédits", operations: [{ op: "UPDATE_NODE", nodeId: e12!, patch: { credits: 1 } }] });
      expect(codeOf(bad)).toBe("academic.curriculum_invalid");
      expect((await adminOne<{ credits: string }>(db, "SELECT credits::text FROM academic.curriculum_nodes WHERE id = $1", [e12])).credits).toBe("3.00");
      // les deux ensemble restent valides
      const ok2 = unwrap(
        await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, {
          reason: "Réajustement des crédits de l'UE1",
          operations: [{ op: "UPDATE_NODE", nodeId: e12!, patch: { credits: 2 } }, { op: "UPDATE_NODE", nodeId: h.ue1.id, patch: { credits: 5 } }],
        }),
      );
      expect(ok2.report.valid).toBe(true);
      expect((await listCurriculumAmendments(w.deps, w.ctx, h.versionId)).ok).toBe(true);
      // structure : ajout autorisé, retrait refusé si le nœud est utilisé
      const added = unwrap(
        await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Nouvel élément constitutif", operations: [{ op: "ADD_NODE", node: { nodeTypeCode: "ECUE", code: "E13", label: "E13", parentId: h.ue1.id, subjectId: h.subjectIds[2]!, credits: 1 } }, { op: "UPDATE_NODE", nodeId: h.ue1.id, patch: { credits: 6 } }] }),
      );
      expect(added.amendments).toBe(2); // NODE_ADDED + CREDITS de l'UE1
      guard.ids.add(e12!);
      const refused = await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Retrait d'un élément noté", operations: [{ op: "REMOVE_NODE", nodeId: e12! }] });
      expect(codeOf(refused)).toBe("academic.node_in_use");
      guard.ids.delete(e12!);
      const moved = unwrap(await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Déplacement vers l'UE2", operations: [{ op: "MOVE_NODE", nodeId: e12!, parentId: h.ue2.id }, { op: "UPDATE_NODE", nodeId: h.ue1.id, patch: { credits: 4 } }, { op: "UPDATE_NODE", nodeId: h.ue2.id, patch: { credits: 8 } }] }));
      expect(moved.report.valid).toBe(true);
      const kinds = unwrap(await listCurriculumAmendments(w.deps, w.ctx, h.versionId)).map((a) => a.kind);
      expect(kinds).toEqual(expect.arrayContaining(["COEFFICIENT", "CREDITS", "NODE_ADDED", "NODE_MOVED"]));
      expect((w.audit as RecordingAudit).entries.filter((e) => e.entry.action === "academic.curriculum.amended").every((e) => e.entry.sensitive === true && e.entry.reason)).toBe(true);
      expect((await eventsOf(w, "academic.curriculum.amended")).length).toBe(4);
      await assertEventsValid(w);
    });

    it("par défaut (aucun module de notes branché), tout amendement structurel est refusé : repli SÛR", async () => {
      const w = await newWorld(); // assumeNodesInUse
      const h = await seedHigher(w);
      const r = await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Déplacement sans garde", operations: [{ op: "REMOVE_NODE", nodeId: h.ue2.ecueIds[1]! }] });
      expect(codeOf(r)).toBe("academic.node_in_use");
      // un amendement numérique reste possible
      expect(unwrap(await amendPublishedCurriculum(w.deps, w.ctx, h.versionId, { reason: "Libellé corrigé", operations: [{ op: "UPDATE_NODE", nodeId: h.ue2.ecueIds[1]!, patch: { label: "Statistiques" } }] })).amendments).toBe(1);
      void nothingInUse;
    });

    it("prérequis par lignée (ET) validés via CompletionLookup ; auto-référence, cycle, lignée inconnue refusés", async () => {
      const completion = new FakeCompletion();
      const w = await newWorld({ completion });
      const h = await seedHigher(w);
      const y2 = await chainYear(w, "N");
      const v = unwrap(await cloneCurriculumVersion(w.deps, w.ctx, { sourceVersionId: h.versionId, targetAcademicYearId: y2.id }));
      const nodes = await adminRows<{ id: string; lineage_id: string; code: string }>(db, "SELECT id, lineage_id, code FROM academic.curriculum_nodes WHERE version_id = $1", [v.id]);
      const by = (c: string) => nodes.find((n) => n.code === c)!;
      expect(codeOf(await setNodePrerequisites(w.deps, w.ctx, by("UE2").id, [by("UE2").lineage_id]))).toBe("academic.prerequisite_self");
      expect(codeOf(await setNodePrerequisites(w.deps, w.ctx, by("UE2").id, [newId()]))).toBe("academic.prerequisite_unknown_lineage");
      unwrap(await setNodePrerequisites(w.deps, w.ctx, by("UE2").id, [by("UE1").lineage_id, by("E11").lineage_id]));
      expect(codeOf(await setNodePrerequisites(w.deps, w.ctx, by("UE1").id, [by("UE2").lineage_id]))).toBe("academic.prerequisite_cycle");
      const student = newId();
      const none = unwrap(await getNodePrerequisiteStatus(w.deps, w.ctx, { studentId: student, nodeId: by("UE2").id }));
      expect(none.satisfied).toBe(false);
      expect(none.missing.map((m) => m.code).sort()).toEqual(["E11", "UE1"]);
      completion.validate(student, by("UE1").lineage_id);
      const some = unwrap(await getNodePrerequisiteStatus(w.deps, w.ctx, { studentId: student, nodeId: by("UE2").id }));
      expect(some.missing.map((m) => m.code)).toEqual(["E11"]);
      completion.validate(student, by("E11").lineage_id);
      expect(unwrap(await getNodePrerequisiteStatus(w.deps, w.ctx, { studentId: student, nodeId: by("UE2").id }))).toEqual({ satisfied: true, missing: [] });
      // remplacer les prérequis ; vider
      unwrap(await setNodePrerequisites(w.deps, w.ctx, by("UE2").id, []));
      expect(unwrap(await getNodePrerequisiteStatus(w.deps, w.ctx, { studentId: newId(), nodeId: by("UE2").id })).satisfied).toBe(true);
      // un nœud cité comme prérequis ne se supprime pas
      unwrap(await setNodePrerequisites(w.deps, w.ctx, by("UE2").id, [by("E11").lineage_id]));
      expect(codeOf(await removeCurriculumNode(w.deps, w.ctx, by("UE1").id))).toBe("academic.node_in_use");
    });

    it("matière mutualisée (AC2.6) : deux nœuds, deux coefficients ; suppression refusée tant qu'un nœud la cite ; transversal marqué par donnée (AC2.7)", async () => {
      const w = await newWorld();
      const h = await seedHigher(w);
      const y2 = await chainYear(w, "N");
      const v = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: h.programId, academicYearId: y2.id }));
      const lvl = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { nodeTypeCode: "LEVEL", code: "L1", label: "L1", gradeLevelId: h.gradeLevelId }));
      const per = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: lvl.id, nodeTypeCode: "PERIOD", code: "S1", label: "S1", periodTypeCode: "SEMESTER", periodOrdinal: 1 }));
      const u1 = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: per.id, nodeTypeCode: "UE", code: "UA", label: "UA", credits: 3 }));
      const u2 = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: per.id, nodeTypeCode: "UE", code: "UB", label: "UB", credits: 3 }));
      const shared = h.subjectIds[0]!;
      unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: u1.id, nodeTypeCode: "ECUE", code: "M1", label: "Maths", subjectId: shared, credits: 3, coefficient: 2 }));
      unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: u2.id, nodeTypeCode: "ECUE", code: "M2", label: "Maths", subjectId: shared, credits: 3, coefficient: 4 }));
      expect((await adminRows(db, "SELECT coefficient FROM academic.curriculum_nodes WHERE version_id = $1 AND subject_id = $2 ORDER BY coefficient", [v.id, shared])).map((r) => r.coefficient)).toEqual(["2.000", "4.000"]);
      expect(codeOf(await deleteSubject(w.deps, w.ctx, shared))).toBe("academic.subject_in_use");
      const loose = unwrap(await createSubject(w.deps, w.ctx, { institutionId: w.institutionId, code: "LIBRE", label: "Libre" }));
      unwrap(await deleteSubject(w.deps, w.ctx, loose.id));
      expect(codeOf(await createSubject(w.deps, w.ctx, { institutionId: w.institutionId, code: "ALGO", label: "Doublon" }))).toBe("academic.subject_code_taken");
      // transversal : une donnée du nœud, aucune détection par libellé
      const t = unwrap(await addCurriculumNode(w.deps, w.ctx, v.id, { parentId: lvl.id, nodeTypeCode: "GROUP", code: "VIE", label: "Conduite", isTransversal: true }));
      expect(t.isTransversal).toBe(true);
      expect(unwrap(await setProgramGradeLevels(w.deps, w.ctx, h.programId, [h.gradeLevelId])).gradeLevelIds).toEqual([h.gradeLevelId]);
      const other = unwrap(await listReference(w.deps, w.ctx, "grade-levels")).find((g) => g.code === "L2")!;
      expect(unwrap(await setProgramGradeLevels(w.deps, w.ctx, h.programId, [h.gradeLevelId, other.id])).gradeLevelIds).toHaveLength(2);
      unwrap(await setProgramGradeLevels(w.deps, w.ctx, h.programId, [h.gradeLevelId, other.id])); // idempotent
      const retire = await setProgramGradeLevels(w.deps, w.ctx, h.programId, [other.id]); // L1 est utilisé par une classe
      expect(codeOf(retire)).toBe("academic.grade_level_in_use");
      void InMemoryStudentDirectory;
    });
  });
});
