/**
 * Les invariants imposés par la BASE (défense en profondeur) : même une requête manuelle ou un bug applicatif ne peut
 * pas contourner la grammaire du curriculum, la capacité, les transitions d'état ni l'immuabilité de l'historique.
 * Les écritures « hors application » passent par la connexion administrateur : les déclencheurs et contraintes
 * s'appliquent à tout le monde.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  addCurriculumNode,
  addEnrollmentCourse,
  classroomAction,
  createClassroom,
  createCurriculumVersion,
  enrollStudent,
  openOfferingsForPeriod,
  putReference,
  setNodePrerequisites,
  transitionEnrollment,
} from "../../index";
import { addDays } from "../../domain/dates";
import { adminOne, adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, makeWorld, seedHigher, todayOf, type HigherSeed, type World } from "../support/world";

describeIntegration("contraintes et déclencheurs de la base (Postgres réel)", () => {
  let db: AcademicTestDb;
  let w: World;
  let s: HigherSeed;

  const sql = (text: string, params: unknown[] = []) => db.admin.query(text, params);
  const refuses = (text: string, params: unknown[], pattern: RegExp) => expect(sql(text, params)).rejects.toThrow(pattern);

  beforeAll(async () => {
    db = await createAcademicTestDb();
    w = makeWorld(db, await db.createTenant());
    s = await seedHigher(w, { capacity: 2 });
  });
  afterAll(async () => {
    await db.drop();
  });

  // ------------------------------------------------------------------------------------------------ calendrier
  describe("années et périodes", () => {
    it("deux années d'un établissement ne se chevauchent pas (EXCLUDE) ; un autre établissement : autorisé", async () => {
      const year = await adminOne<{ starts_on: string; ends_on: string }>(db, "SELECT to_char(starts_on,'YYYY-MM-DD') starts_on, to_char(ends_on,'YYYY-MM-DD') ends_on FROM academic.academic_years WHERE id = $1", [s.yearId]);
      await refuses(
        "INSERT INTO academic.academic_years (id, tenant_id, institution_id, code, label, starts_on, ends_on) VALUES ($1,$2,$3,'X','x',$4::date + 10,$5::date + 10)",
        [newId(), w.tenantId, w.institutionId, year.starts_on, year.ends_on],
        /exclusion|conflicting/i,
      );
      await sql("INSERT INTO academic.academic_years (id, tenant_id, institution_id, code, label, starts_on, ends_on) VALUES ($1,$2,$3,'AUTRE','x',$4::date + 10,$5::date + 10)", [newId(), w.tenantId, newId(), year.starts_on, year.ends_on]);
    });
    it("une seule année courante par établissement, et seulement si elle est ouverte", async () => {
      const y2 = newId();
      await sql("INSERT INTO academic.academic_years (id, tenant_id, institution_id, code, label, starts_on, ends_on) VALUES ($1,$2,$3,'Y2','x','2090-01-01','2090-12-31')", [y2, w.tenantId, w.institutionId]);
      await refuses("UPDATE academic.academic_years SET is_current = true WHERE id = $1", [y2], /check constraint/i); // pas OPEN
      await refuses("UPDATE academic.academic_years SET status = 'OPEN', is_current = true WHERE id = $1", [y2], /academic_years_one_current/);
    });
    it("find_year_gaps() détecte un trou entre deux années consécutives", async () => {
      const gaps = await w.deps.db.run(w.ctx, (tx) => tx.many("SELECT * FROM academic.find_year_gaps()"));
      expect(gaps.length).toBeGreaterThanOrEqual(1); // l'année 2090 est séparée de l'année de test
    });
    it("une période tient dans son année et dans son parent, trois niveaux au plus", async () => {
      await refuses(
        "INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, period_type_code, ordinal, code, label, starts_on, ends_on) VALUES ($1,$2,$3,'COMPOSITION',1,'C1','c','1999-01-01','1999-02-01')",
        [newId(), w.tenantId, s.yearId],
        /academic\.period_outside_year/,
      );
      const parent = s.periodIds[0]!;
      const p = await adminOne<{ starts_on: string; ends_on: string }>(db, "SELECT to_char(starts_on,'YYYY-MM-DD') starts_on, to_char(ends_on,'YYYY-MM-DD') ends_on FROM academic.academic_periods WHERE id = $1", [parent]);
      await refuses(
        "INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, parent_period_id, period_type_code, ordinal, code, label, starts_on, ends_on) VALUES ($1,$2,$3,$4,'NORMAL_SESSION',1,'N1','n',$5::date + 10,$6::date + 5)",
        [newId(), w.tenantId, s.yearId, parent, p.starts_on, p.ends_on],
        /academic\.period_outside_parent/,
      );
      // année > S1 > N1 > N1A : accepté ; une quatrième profondeur est refusée
      const n1 = newId();
      const n1a = newId();
      const insertSub = (id: string, parentId: string, type: string, code: string, plus: number) =>
        sql(
          "INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, parent_period_id, period_type_code, ordinal, code, label, starts_on, ends_on) VALUES ($1,$2,$3,$4,$5,1,$6,'n',$7::date,$7::date + $8::int)",
          [id, w.tenantId, s.yearId, parentId, type, code, p.starts_on, plus],
        );
      await insertSub(n1, parent, "NORMAL_SESSION", "N1", 20);
      await insertSub(n1a, n1, "COMPOSITION", "N1A", 5);
      await expect(insertSub(newId(), n1a, "MODULE", "N1B", 1)).rejects.toThrow(/academic\.period_too_deep/);
    });
    it("deux périodes sœurs de même type ne se chevauchent pas", async () => {
      await refuses(
        "INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, period_type_code, ordinal, code, label, starts_on, ends_on) SELECT $1,$2,academic_year_id,'SEMESTER',3,'SX','x',starts_on,ends_on FROM academic.academic_periods WHERE id = $3",
        [newId(), w.tenantId, s.periodIds[0]],
        /exclusion|conflicting/i,
      );
    });
    it("transitions d'une période : aucun saut ; dates figées une fois les notes closes ; suppression seulement PLANNED", async () => {
      const [s1, s2] = s.periodIds;
      await refuses("UPDATE academic.academic_periods SET status = 'CLOSED' WHERE id = $1", [s1], /academic\.period_transition/);
      await refuses("UPDATE academic.academic_periods SET status = 'GRADING_CLOSED' WHERE id = $1", [s2], /academic\.period_transition/);
      await refuses("DELETE FROM academic.academic_periods WHERE id = $1", [s1], /academic\.period_delete_forbidden/);
      await sql("UPDATE academic.academic_periods SET status = 'GRADING_CLOSED' WHERE id = $1", [s1]);
      await refuses("UPDATE academic.academic_periods SET ends_on = ends_on - 1 WHERE id = $1", [s1], /academic\.period_closed_dates/);
      await refuses("UPDATE academic.academic_periods SET period_type_code = 'TRIMESTER' WHERE id = $1", [s1], /academic\.period_identity_immutable/);
      await sql("UPDATE academic.academic_periods SET status = 'OPEN' WHERE id = $1", [s1]); // retour d'un pas
      const old = await adminOne<{ starts_on: string }>(db, "SELECT to_char(ends_on + 1,'YYYY-MM-DD') starts_on FROM academic.academic_periods WHERE id = $1", [s1]);
      const year = await adminOne<{ ends_on: string }>(db, "SELECT to_char(ends_on,'YYYY-MM-DD') ends_on FROM academic.academic_years WHERE id = $1", [s.yearId]);
      await sql("DELETE FROM academic.academic_periods WHERE id = $1", [s2]); // PLANNED : supprimable
      await sql(
        "INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, period_type_code, ordinal, code, label, starts_on, ends_on) VALUES ($1,$2,$3,'SEMESTER',2,'SEMESTER_2','Semestre 2',$4::date,$5::date)",
        [s2, w.tenantId, s.yearId, old.starts_on, year.ends_on],
      );
    });
  });

  // ------------------------------------------------------------------------------------------------ curriculum
  describe("curriculum : grammaire, publication, prérequis", () => {
    interface N { id?: string; lineage?: string; parent: string | null; type: string; code: string; subject?: string | null; level?: string | null; ptype?: string | null; pord?: number | null; coef?: string | null; credits?: string | null; version?: string }
    let draftVersion: string;
    let draftLevel: string;
    const insertNode = async (n: N): Promise<{ id: string; lineage: string }> => {
      const id = n.id ?? newId();
      const lineage = n.lineage ?? newId();
      await sql(
        `INSERT INTO academic.curriculum_nodes (id, tenant_id, version_id, parent_id, node_type_code, lineage_id, subject_id, grade_level_id, period_type_code, period_ordinal, code, label, coefficient, credits)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)`,
        [id, w.tenantId, n.version ?? draftVersion, n.parent, n.type, lineage, n.subject ?? null, n.level ?? null, n.ptype ?? null, n.pord ?? null, n.code, n.coef ?? null, n.credits ?? null],
      );
      return { id, lineage };
    };

    beforeAll(async () => {
      const y2 = await adminOne<{ id: string }>(db, "SELECT id FROM academic.academic_years WHERE code = 'Y2'");
      const v = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: s.programId, academicYearId: y2.id }));
      draftVersion = v.id;
      draftLevel = unwrap(await addCurriculumNode(w.deps, w.ctx, draftVersion, { nodeTypeCode: "LEVEL", code: "L1", label: "L1", gradeLevelId: s.gradeLevelId })).id;
    });

    it("un ECUE sous un LEVEL, une matière absente, des crédits sur un GROUP… sont refusés (grammaire en base)", async () => {
      await expect(insertNode({ parent: draftLevel, type: "ECUE", code: "E1", subject: s.subjectIds[0]! })).rejects.toThrow(/academic\.node_bad_parent/);
      await expect(insertNode({ parent: draftLevel, type: "SUBJECT", code: "S1" })).rejects.toThrow(/academic\.node_subject_required/);
      await expect(insertNode({ parent: draftLevel, type: "GROUP", code: "G1", credits: "2" })).rejects.toThrow(/academic\.node_credits_forbidden/);
      await expect(insertNode({ parent: draftLevel, type: "GROUP", code: "G2", coef: "2" })).rejects.toThrow(/academic\.node_coefficient_forbidden/);
      await expect(insertNode({ parent: draftLevel, type: "GROUP", code: "G3", subject: s.subjectIds[0]! })).rejects.toThrow(/academic\.node_subject_forbidden/);
      await expect(insertNode({ parent: null, type: "GROUP", code: "G4" })).rejects.toThrow(/academic\.node_needs_parent/);
      await expect(insertNode({ parent: draftLevel, type: "PERIOD", code: "P1" })).rejects.toThrow(/academic\.node_period_slot_required/);
      await expect(insertNode({ parent: draftLevel, type: "GROUP", code: "G5", ptype: "SEMESTER", pord: 1 })).rejects.toThrow(/academic\.node_period_slot_forbidden/);
      await expect(insertNode({ parent: null, type: "LEVEL", code: "LX" })).rejects.toThrow(/academic\.node_grade_level_required/);
      await expect(insertNode({ parent: draftLevel, type: "GROUP", code: "G6", level: s.gradeLevelId })).rejects.toThrow(/academic\.node_grade_level_forbidden/);
    });
    it("un niveau non couvert par le programme est refusé", async () => {
      const m2 = await adminOne<{ id: string }>(db, "SELECT id FROM academic.grade_levels WHERE code = 'M2'");
      await expect(insertNode({ parent: null, type: "LEVEL", code: "LM2", level: m2.id })).rejects.toThrow(/academic\.node_level_not_in_program/);
    });
    it("déplacer un nœud sous son propre descendant crée un cycle : refusé (type de nœud ajouté en DONNÉES)", async () => {
      // Aucun type livré ne s'emboîte lui-même : on en ajoute un par une ligne de données (pas de code).
      unwrap(await putReference(w.deps, w.ctx, "node-types", [{ code: "BLOCK", label: "Bloc", allowedParentCodes: ["LEVEL", "BLOCK"], sortOrder: 90 }]));
      const a = await insertNode({ parent: draftLevel, type: "BLOCK", code: "BA" });
      const b = await insertNode({ parent: a.id, type: "BLOCK", code: "BB" });
      await refuses("UPDATE academic.curriculum_nodes SET parent_id = $2 WHERE id = $1", [a.id, b.id], /academic\.node_cycle/);
      await refuses("UPDATE academic.curriculum_nodes SET parent_id = $2 WHERE id = $1", [a.id, a.id], /academic\.node_cycle|check constraint/i);
    });
    it("l'identité d'un nœud (type, lignée, version) est figée", async () => {
      const n = await adminOne<{ id: string }>(db, "SELECT id FROM academic.curriculum_nodes WHERE code = 'BA' AND version_id = $1", [draftVersion]);
      await refuses("UPDATE academic.curriculum_nodes SET lineage_id = $2 WHERE id = $1", [n.id, newId()], /academic\.node_identity_immutable/);
      await refuses("UPDATE academic.curriculum_nodes SET node_type_code = 'GROUP' WHERE id = $1", [n.id], /academic\.node_identity_immutable/);
    });
    it("deux nœuds de même code sous le même parent : refusé ; sous des parents différents : autorisé", async () => {
      await expect(insertNode({ parent: draftLevel, type: "BLOCK", code: "BA" })).rejects.toThrow(/curriculum_nodes_sibling_code/);
      const ga = await insertNode({ parent: draftLevel, type: "GROUP", code: "GA" });
      await insertNode({ parent: ga.id, type: "SUBJECT", code: "ALGO", subject: s.subjectIds[0]! });
      const gb = await insertNode({ parent: draftLevel, type: "GROUP", code: "GB" });
      await insertNode({ parent: gb.id, type: "SUBJECT", code: "ALGO", subject: s.subjectIds[0]!, coef: "5" });
    });
    it("une même matière figure dans deux nœuds (mutualisation) ; une matière référencée ne se supprime pas", async () => {
      const rows = await adminRows(db, "SELECT coefficient FROM academic.curriculum_nodes WHERE subject_id = $1 AND version_id = $2", [s.subjectIds[0], draftVersion]);
      expect(rows).toHaveLength(2);
      await refuses("DELETE FROM academic.subjects WHERE id = $1", [s.subjectIds[0]], /foreign key|violates/i);
    });

    it("prérequis : pas d'auto-référence, lignée inconnue refusée, cycle refusé", async () => {
      const a = await adminOne<{ id: string; lineage_id: string }>(db, "SELECT id, lineage_id FROM academic.curriculum_nodes WHERE code = 'ALGO' AND parent_id = (SELECT id FROM academic.curriculum_nodes WHERE code = 'GA' AND version_id = $1)", [draftVersion]);
      const b = await adminOne<{ id: string; lineage_id: string }>(db, "SELECT id, lineage_id FROM academic.curriculum_nodes WHERE code = 'ALGO' AND parent_id = (SELECT id FROM academic.curriculum_nodes WHERE code = 'GB' AND version_id = $1)", [draftVersion]);
      const pre = (version: string, node: string, lineage: string) =>
        sql("INSERT INTO academic.curriculum_prerequisites (id, tenant_id, version_id, node_id, required_lineage_id) VALUES ($1,$2,$3,$4,$5)", [newId(), w.tenantId, version, node, lineage]);
      await expect(pre(draftVersion, a.id, a.lineage_id)).rejects.toThrow(/academic\.prerequisite_self/);
      await expect(pre(draftVersion, a.id, newId())).rejects.toThrow(/academic\.prerequisite_unknown_lineage/);
      await pre(draftVersion, a.id, b.lineage_id);
      await expect(pre(draftVersion, b.id, a.lineage_id)).rejects.toThrow(/academic\.prerequisite_cycle/);
    });

    it("version PUBLIÉE : ni ajout, ni suppression, ni déplacement ; coefficient et crédits modifiables ; amendement structurel par réglage de session", async () => {
      const e = s.ue1.ecueIds[0]!;
      await expect(insertNode({ parent: s.ue1.id, type: "ECUE", code: "NEW", subject: s.subjectIds[2]!, version: s.versionId })).rejects.toThrow(/academic\.curriculum_published/);
      await refuses("DELETE FROM academic.curriculum_nodes WHERE id = $1", [e], /academic\.curriculum_published/);
      await refuses("UPDATE academic.curriculum_nodes SET parent_id = $2 WHERE id = $1", [e, s.ue2.id], /academic\.curriculum_published/);
      await refuses("UPDATE academic.curriculum_nodes SET is_mandatory = false WHERE id = $1", [e], /academic\.curriculum_published/);
      await sql("UPDATE academic.curriculum_nodes SET coefficient = 3 WHERE id = $1", [e]); // numérique : autorisé
      await sql("UPDATE academic.curriculum_nodes SET coefficient = 2 WHERE id = $1", [e]);
      // avec le réglage de session, la structure peut bouger (c'est ce que fait `amendPublishedCurriculum`)
      await sql("BEGIN");
      try {
        await sql("SELECT set_config('academic.structural_change','on', true)");
        await sql("UPDATE academic.curriculum_nodes SET is_mandatory = false WHERE id = $1", [e]);
      } finally {
        await sql("ROLLBACK");
      }
    });
    it("prérequis d'une version publiée : ne changent que par amendement", async () => {
      const [e1, e2] = [s.ue1.ecueIds[0]!, s.ue1.ecueIds[1]!];
      const lineage = (await adminOne<{ lineage_id: string }>(db, "SELECT lineage_id FROM academic.curriculum_nodes WHERE id = $1", [e1])).lineage_id;
      await refuses("INSERT INTO academic.curriculum_prerequisites (id, tenant_id, version_id, node_id, required_lineage_id) VALUES ($1,$2,$3,$4,$5)", [newId(), w.tenantId, s.versionId, e2, lineage], /academic\.curriculum_published/);
      const viaUseCase = await setNodePrerequisites(w.deps, w.ctx, e2, [lineage]);
      expect(!viaUseCase.ok && viaUseCase.error.code).toBe("academic.curriculum_published");
    });
    it("l'historique des amendements est append-only", async () => {
      await sql("INSERT INTO academic.curriculum_amendments (id, tenant_id, version_id, kind, reason, amended_by) VALUES ($1,$2,$3,'OTHER','motif valable',$4)", [newId(), w.tenantId, s.versionId, newId()]);
      await refuses("UPDATE academic.curriculum_amendments SET reason = 'réécrit' WHERE version_id = $1", [s.versionId], /academic\.immutable/);
      await refuses("DELETE FROM academic.curriculum_amendments WHERE version_id = $1", [s.versionId], /academic\.immutable/);
      await refuses("INSERT INTO academic.curriculum_amendments (id, tenant_id, version_id, kind, reason, amended_by) VALUES ($1,$2,$3,'OTHER','abc',$4)", [newId(), w.tenantId, s.versionId, newId()], /check constraint/i);
    });
    it("transitions d'une version ; identité figée ; une version VERROUILLÉE n'accepte plus aucune écriture", async () => {
      await refuses("UPDATE academic.curriculum_versions SET status = 'LOCKED' WHERE id = $1", [draftVersion], /academic\.version_transition/); // DRAFT -> LOCKED
      await refuses("UPDATE academic.curriculum_versions SET program_id = $2 WHERE id = $1", [s.versionId, newId()], /academic\.version_identity_immutable/);
      await sql("UPDATE academic.curriculum_versions SET status = 'PUBLISHED', published_at = now() WHERE id = $1", [draftVersion]);
      await sql("UPDATE academic.curriculum_versions SET status = 'LOCKED', locked_at = now() WHERE id = $1", [draftVersion]);
      await expect(insertNode({ parent: draftLevel, type: "GROUP", code: "GZ" })).rejects.toThrow(/academic\.curriculum_locked/);
      await refuses("UPDATE academic.curriculum_nodes SET label = 'x' WHERE version_id = $1", [draftVersion], /academic\.curriculum_locked/);
      await refuses("DELETE FROM academic.curriculum_nodes WHERE version_id = $1 AND code = 'GA'", [draftVersion], /academic\.curriculum_locked/);
    });
  });

  // ------------------------------------------------------------------------------------------------ classes
  describe("classes et offres", () => {
    it("niveau non couvert, curriculum d'un autre programme/année, activation sans curriculum : refusés", async () => {
      const m2 = await adminOne<{ id: string }>(db, "SELECT id FROM academic.grade_levels WHERE code = 'M2'");
      await refuses(
        "INSERT INTO academic.classrooms (id, tenant_id, institution_id, academic_year_id, program_id, grade_level_id, code, name) VALUES ($1,$2,$3,$4,$5,$6,'CX','cx')",
        [newId(), w.tenantId, w.institutionId, s.yearId, s.programId, m2.id],
        /academic\.classroom_level_not_in_program/,
      );
      const y2 = await adminOne<{ id: string }>(db, "SELECT id FROM academic.academic_years WHERE code = 'Y2'");
      await refuses(
        "INSERT INTO academic.classrooms (id, tenant_id, institution_id, academic_year_id, program_id, grade_level_id, curriculum_version_id, code, name) VALUES ($1,$2,$3,$4,$5,$6,$7,'CY','cy')",
        [newId(), w.tenantId, w.institutionId, y2.id, s.programId, s.gradeLevelId, s.versionId],
        /academic\.classroom_curriculum_mismatch/,
      );
      await refuses(
        "INSERT INTO academic.classrooms (id, tenant_id, institution_id, academic_year_id, program_id, grade_level_id, code, name, status) VALUES ($1,$2,$3,$4,$5,$6,'CZ','cz','ACTIVE')",
        [newId(), w.tenantId, w.institutionId, s.yearId, s.programId, s.gradeLevelId],
        /check constraint/i,
      );
    });
    it("identité figée, transitions légales, aucune suppression, nom et code uniques", async () => {
      const l2 = await adminOne<{ id: string }>(db, "SELECT id FROM academic.grade_levels WHERE code = 'L2'");
      await sql("INSERT INTO academic.program_grade_levels (tenant_id, program_id, grade_level_id, ordinal) VALUES ($1,$2,$3,1)", [w.tenantId, s.programId, l2.id]);
      await refuses("UPDATE academic.classrooms SET grade_level_id = $2 WHERE id = $1", [s.classroomId, l2.id], /academic\.classroom_identity_immutable/);
      await refuses("UPDATE academic.classrooms SET status = 'ARCHIVED' WHERE id = $1", [s.classroomId], /academic\.classroom_transition/);
      await refuses("DELETE FROM academic.classrooms WHERE id = $1", [s.classroomId], /academic\.immutable/);
      await refuses(
        "INSERT INTO academic.classrooms (id, tenant_id, institution_id, academic_year_id, program_id, grade_level_id, code, name) VALUES ($1,$2,$3,$4,$5,$6,'L1-A','autre nom')",
        [newId(), w.tenantId, w.institutionId, s.yearId, s.programId, s.gradeLevelId],
        /duplicate|unique/i,
      );
      await refuses(
        "INSERT INTO academic.classrooms (id, tenant_id, institution_id, academic_year_id, program_id, grade_level_id, code, name) VALUES ($1,$2,$3,$4,$5,$6,'L1-Z','Licence 1 A')",
        [newId(), w.tenantId, w.institutionId, s.yearId, s.programId, s.gradeLevelId],
        /duplicate|unique/i,
      );
    });
    it("offres : nœud hors curriculum, non inscriptible, dates hors année refusés", async () => {
      const offer = (node: string, starts = todayOf(w), ends = todayOf(w)) =>
        sql("INSERT INTO academic.classroom_offerings (id, tenant_id, classroom_id, curriculum_node_id, label, starts_on, ends_on) VALUES ($1,$2,$3,$4,'o',$5::date,$6::date)", [newId(), w.tenantId, s.classroomId, node, starts, ends]);
      await expect(offer(s.levelNodeId)).rejects.toThrow(/academic\.offering_node_not_enrollable/);
      await expect(offer(s.ue1.ecueIds[0]!)).rejects.toThrow(/academic\.offering_node_not_enrollable/);
      await expect(offer(s.ue1.id, "1999-01-01", "1999-02-01")).rejects.toThrow(/academic\.offering_outside_year/);
      const foreign = await adminOne<{ id: string }>(db, "SELECT id FROM academic.curriculum_nodes WHERE code = 'GA' LIMIT 1");
      await expect(offer(foreign.id)).rejects.toThrow(/academic\.offering_node_not_in_curriculum/);
    });
  });

  // ------------------------------------------------------------------------------------------------ inscriptions
  describe("inscriptions", () => {
    it("identité figée, transitions légales, financement exigé, pas de suppression, historique immuable", async () => {
      const st = addStudent(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
      await refuses("UPDATE academic.enrollments SET student_id = $2 WHERE id = $1", [e.id, newId()], /academic\.enrollment_identity_immutable/);
      await refuses("UPDATE academic.enrollments SET status = 'COMPLETED' WHERE id = $1", [e.id], /academic\.enrollment_transition/);
      await refuses("DELETE FROM academic.enrollments WHERE id = $1", [e.id], /academic\.immutable/);
      await refuses("UPDATE academic.enrollments SET funding_type = 'STATE_ASSIGNED' WHERE id = $1", [e.id], /academic\.funding_reference_required/);
      await refuses("UPDATE academic.enrollments SET funding_type = 'PRIVATE', assignment_reference = 'X' WHERE id = $1", [e.id], /check constraint/i);
      await refuses("UPDATE academic.enrollment_history SET reason = 'réécrit' WHERE enrollment_id = $1", [e.id], /academic\.immutable/);
      await refuses("DELETE FROM academic.enrollment_history WHERE enrollment_id = $1", [e.id], /academic\.immutable/);
      unwrap(await transitionEnrollment(w.deps, w.ctx, e.id, "cancel", "annulée pour le test"));
      await refuses("UPDATE academic.enrollments SET status = 'ACTIVE', ended_on = NULL WHERE id = $1", [e.id], /academic\.enrollment_transition/); // terminal
    });
    it("l'inscription vivante est unique par classe ; une seule inscription de classe par année et établissement", async () => {
      const st = addStudent(w);
      unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
      const other = unwrap(
        await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "L1-B", name: "Licence 1 B" }),
      );
      unwrap(await classroomAction(w.deps, w.ctx, other.id, "activate"));
      const insert = (classroom: string, mode: string) =>
        sql(`INSERT INTO academic.enrollments (id, tenant_id, institution_id, academic_year_id, student_id, classroom_id, mode, status, enrolled_on) VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',now()::date)`, [newId(), w.tenantId, w.institutionId, s.yearId, st.studentId, classroom, mode]);
      await expect(insert(other.id, "CLASS")).rejects.toThrow(/enrollments_one_class_mode_per_year/);
      await expect(insert(s.classroomId, "A_LA_CARTE")).rejects.toThrow(/enrollments_one_live_per_class/);
    });
    it("capacité dure d'une classe imposée par la base (verrou de ligne) : la 3e inscription est refusée", async () => {
      const a = await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId });
      const b = await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId });
      const live = await adminOne<{ n: number }>(db, "SELECT count(*)::int n FROM academic.enrollments WHERE classroom_id = $1 AND status IN ('PENDING','ACTIVE','SUSPENDED') AND mode = 'CLASS'", [s.classroomId]);
      expect(live.n).toBe(2);
      const refused = [a, b].filter((r) => !r.ok);
      expect(refused).toHaveLength(1);
      expect(!refused[0]!.ok && refused[0]!.error.code).toBe("academic.classroom_full");
      await refuses(
        `INSERT INTO academic.enrollments (id, tenant_id, institution_id, academic_year_id, student_id, classroom_id, mode, status, enrolled_on) VALUES ($1,$2,$3,$4,$5,$6,'CLASS','PENDING',now()::date)`,
        [newId(), w.tenantId, w.institutionId, s.yearId, newId(), s.classroomId],
        /academic\.classroom_full/,
      );
    });
  });

  describe("offres à la carte : capacité dérivée, réservations, doublons", () => {
    let offeringId: string;
    let cartClassroom: string;
    const students: string[] = [];
    beforeAll(async () => {
      const c = unwrap(
        await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "L1-C", name: "Licence 1 à la carte", capacity: null }),
      );
      unwrap(await classroomAction(w.deps, w.ctx, c.id, "activate"));
      cartClassroom = c.id;
      const r = unwrap(await openOfferingsForPeriod(w.deps, w.ctx, c.id, { periodNodeId: s.periodNodeId, startsOn: todayOf(w), endsOn: addDays(todayOf(w), 60), capacity: 2, open: true }));
      offeringId = r.created.find((o) => o.curriculumNodeId === s.ue1.id)!.id;
      for (let i = 0; i < 3; i += 1) students.push(addStudent(w).studentId);
    });
    const enroll = async (studentId: string) => unwrap(await enrollStudent(w.deps, w.ctx, { studentId, classroomId: cartClassroom, mode: "A_LA_CARTE" }));
    const offeringStatus = async () => (await adminOne<{ status: string }>(db, "SELECT status FROM academic.classroom_offerings WHERE id = $1", [offeringId])).status;

    it("FULL est dérivé par la base à la capacité ; une réservation expirée libère la place (sans attendre le job)", async () => {
      expect(await offeringStatus()).toBe("OPEN");
      const e1 = await enroll(students[0]!);
      const e2 = await enroll(students[1]!);
      const c1 = unwrap(await addEnrollmentCourse(w.deps, w.ctx, e1.id, { offeringId })).course;
      expect(await offeringStatus()).toBe("OPEN");
      unwrap(await addEnrollmentCourse(w.deps, w.ctx, e2.id, { offeringId }));
      expect(await offeringStatus()).toBe("FULL");
      const e3 = await enroll(students[2]!);
      const full = await addEnrollmentCourse(w.deps, w.ctx, e3.id, { offeringId });
      expect(!full.ok && full.error.code).toBe("academic.offering_full");
      await sql("UPDATE academic.enrollment_courses SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [c1.id]);
      const retry = unwrap(await addEnrollmentCourse(w.deps, w.ctx, e3.id, { offeringId }));
      expect(retry.course.status).toBe("PENDING");
      expect(await offeringStatus()).toBe("FULL"); // c2 + c3 = 2 places réservées (c1 est expirée)
    });
    it("la base refuse une sélection dont le nœud ne correspond pas à l'offre, et un cours confirmé sur une inscription non active", async () => {
      const e = (await adminOne<{ id: string }>(db, "SELECT id FROM academic.enrollments WHERE classroom_id = $1 AND status = 'PENDING' LIMIT 1", [cartClassroom])).id;
      await refuses(
        "INSERT INTO academic.enrollment_courses (id, tenant_id, enrollment_id, curriculum_node_id, offering_id, source, status) VALUES ($1,$2,$3,$4,$5,'OPTION','PENDING')",
        [newId(), w.tenantId, e, s.ue2.id, offeringId],
        /academic\.offering_node_mismatch/,
      );
      await refuses(
        "INSERT INTO academic.enrollment_courses (id, tenant_id, enrollment_id, curriculum_node_id, source, status, confirmed_at) VALUES ($1,$2,$3,$4,'OPTION','CONFIRMED',now())",
        [newId(), w.tenantId, e, s.ue2.id],
        /academic\.course_enrollment_not_active/,
      );
    });
    it("une matière transversale ne s'achète jamais à la carte (garde en base)", async () => {
      const e = (await adminOne<{ id: string }>(db, "SELECT id FROM academic.enrollments WHERE classroom_id = $1 AND status = 'PENDING' LIMIT 1", [cartClassroom])).id;
      await sql("BEGIN");
      try {
        await sql("SELECT set_config('academic.structural_change','on', true)");
        await sql("UPDATE academic.curriculum_nodes SET is_transversal = true WHERE id = $1", [s.ue2.ecueIds[1]]);
        await expect(
          sql("INSERT INTO academic.enrollment_courses (id, tenant_id, enrollment_id, curriculum_node_id, offering_id, source, status) VALUES ($1,$2,$3,$4,NULL,'A_LA_CARTE','PENDING')", [newId(), w.tenantId, e, s.ue2.ecueIds[1]]),
        ).rejects.toThrow(/academic\.course_transversal/);
      } finally {
        await sql("ROLLBACK");
      }
    });
    it("un apprenant ne suit pas deux fois le même nœud la même année (garde en base, quelle que soit la classe)", async () => {
      const e = (await adminOne<{ id: string; student_id: string }>(db, "SELECT id, student_id FROM academic.enrollments WHERE classroom_id = $1 AND student_id = $2", [cartClassroom, students[1]])).id;
      await refuses(
        "INSERT INTO academic.enrollment_courses (id, tenant_id, enrollment_id, curriculum_node_id, source, status) VALUES ($1,$2,$3,$4,'OPTION','PENDING')",
        [newId(), w.tenantId, e, s.ue1.id],
        /academic\.duplicate_enrollment|enrollment_courses_one_live/,
      );
    });
  });

  describe("placements, registre des numéros, états par classe", () => {
    it("un seul placement reste ouvert par inscription", async () => {
      const e = await adminOne<{ id: string }>(db, "SELECT id FROM academic.enrollments WHERE status = 'PENDING' LIMIT 1");
      await refuses(
        "INSERT INTO academic.enrollment_placements (id, tenant_id, enrollment_id, classroom_id, starts_on) SELECT $1,$2,enrollment_id,classroom_id,starts_on + 1 FROM academic.enrollment_placements WHERE enrollment_id = $3 LIMIT 1",
        [newId(), w.tenantId, e.id],
        /enrollment_placements_one_open|exclusion|conflicting/i,
      );
    });
    it("le registre garantit l'unicité du numéro dans l'établissement et par (apprenant, programme, niveau)", async () => {
      const student = newId();
      const ins = (n: string, st = student) =>
        sql("INSERT INTO academic.registration_numbers (id, tenant_id, institution_id, student_id, program_id, grade_level_id, registration_number) VALUES ($1,$2,$3,$4,$5,$6,$7)", [newId(), w.tenantId, w.institutionId, st, s.programId, s.gradeLevelId, n]);
      await ins("N-0001");
      await expect(ins("N-0002")).rejects.toThrow(/duplicate|unique/i);
      await expect(ins("N-0001", newId())).rejects.toThrow(/duplicate|unique/i);
    });
    it("l'état d'une classe dans une période : année de la classe, transitions OPEN -> GRADING_CLOSED -> CLOSED", async () => {
      const p1 = s.periodIds[0]!;
      await sql("INSERT INTO academic.classroom_period_states (tenant_id, classroom_id, period_id, status) VALUES ($1,$2,$3,'OPEN')", [w.tenantId, s.classroomId, p1]);
      await refuses("UPDATE academic.classroom_period_states SET status = 'CLOSED' WHERE classroom_id = $1 AND period_id = $2", [s.classroomId, p1], /academic\.classroom_period_transition/);
      await sql("UPDATE academic.classroom_period_states SET status = 'GRADING_CLOSED' WHERE classroom_id = $1 AND period_id = $2", [s.classroomId, p1]);
      const eff = await w.deps.db.run(w.ctx, (tx) => tx.queryOne<{ s: string }>("SELECT academic.effective_period_status($1, $2) AS s", [s.classroomId, p1]));
      expect(eff?.s).toBe("GRADING_CLOSED"); // l'état de la classe surcharge la période, restée OPEN
      const period = await adminOne<{ status: string }>(db, "SELECT status FROM academic.academic_periods WHERE id = $1", [p1]);
      expect(period.status).toBe("OPEN");
      const otherYearPeriod = newId();
      const y2 = await adminOne<{ id: string }>(db, "SELECT id FROM academic.academic_years WHERE code = 'Y2'");
      await sql("INSERT INTO academic.academic_periods (id, tenant_id, academic_year_id, period_type_code, ordinal, code, label, starts_on, ends_on) VALUES ($1,$2,$3,'SEMESTER',1,'S1Y2','s','2090-01-01','2090-06-30')", [otherYearPeriod, w.tenantId, y2.id]);
      await refuses("INSERT INTO academic.classroom_period_states (tenant_id, classroom_id, period_id, status) VALUES ($1,$2,$3,'OPEN')", [w.tenantId, s.classroomId, otherYearPeriod], /academic\.classroom_period_other_year/);
    });
  });

  describe("clés étrangères composites (tenant_id, id)", () => {
    it("une ligne ne peut pas pointer la ligne d'un autre tenant, même en connaissant son UUID", async () => {
      const tenantB = await db.createTenant("tenant-fk-b");
      await refuses(
        "INSERT INTO academic.programs (id, tenant_id, institution_id, education_level_id, code, label) SELECT $1, $2, $3, id, 'ZZZ', 'z' FROM academic.education_levels WHERE tenant_id = $4 LIMIT 1",
        [newId(), tenantB, newId(), w.tenantId],
        /foreign key|violates/i,
      );
    });
  });
});
