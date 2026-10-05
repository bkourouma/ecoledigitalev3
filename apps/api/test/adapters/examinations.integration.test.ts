/**
 * Adaptateurs d'`examinations` sur les VRAIS modules (academic, people, tenancy, assess, rules, reportcards) : élèves et inscriptions,
 * état civil figé à l'inscription, établissements, notes publiées d'`assess`. Les interfaces ATTENDUES des autres modules (contrat
 * `exam-national@1`, `academic.getEligibilityFacts`, natures de documents d'examen) sont traitées EN ÉCHEC FERMÉ tant qu'elles manquent :
 * le test ne fige pas leur absence (il passera aussi une fois livrées) mais exige qu'aucune valeur par défaut ne soit jamais inventée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createExaminationsDeps } from "../../src/modules/examinations/application/deps";
import { createFromClassroom, getCandidateDetail, listCandidates, registerCandidate } from "../../src/modules/examinations/application/candidates";
import { evaluateEligibility } from "../../src/modules/examinations/application/eligibility";
import { noopAudit } from "../../src/modules/examinations/application/ports";
import { createExamType, createPaper } from "../../src/modules/examinations/application/reference";
import { createSession, instantiateSession, transitionSession } from "../../src/modules/examinations/application/sessions";
import { ExamCode } from "../../src/modules/examinations/domain/errors";
import { createExaminationsEligibilityFacts, ageAt } from "../../src/platform/adapters/examinations-directories";
import { createExaminationsOfficialDocuments } from "../../src/platform/adapters/examinations-documents";
import { createOfficialDocumentDeps } from "../../src/platform/adapters/official-documents";
import { createAssemblyWorld, publishAssessment, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";
import { describeIntegration } from "../../src/modules/examinations/test/support/db";

describeIntegration("adaptateurs d'examinations sur les vrais modules", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 3 });
    // Le monde d'academic désigne un établissement SANS fiche de tenancy : on la crée (les références sont des UUID sans clé étrangère).
    await w.db.admin.query("INSERT INTO tenancy.institutions (id, tenant_id, code, name, pack, education_system, country_code) VALUES ($1, $2, 'ecole-test', 'École de test', 'HIGHER', 'CI', 'CI')", [w.academic.institutionId, w.tenantId]);
  });
  afterAll(async () => {
    await w?.drop();
  });

  const deps = () => createExaminationsDeps({ db: w.tenantDb, audit: noopAudit, ports: w.ports.examinations });

  it("branche tous les ports (sauf le stockage sans bucket) ; le stockage absent échoue fermé", () => {
    expect(Object.keys(w.ports.examinations).sort()).toEqual(["assess", "eligibility", "family", "fees", "institutions", "officialDocuments", "pieces", "rules", "students"]);
  });

  it("élèves : inscription, établissement, niveau de la classe, état civil complet depuis people", async () => {
    const ports = w.ports.examinations;
    const e = await ports.students!.getEnrollment(w.director, school.pupils[0]!.enrollmentId);
    expect(e).toMatchObject({ studentId: school.pupils[0]!.studentId, institutionId: w.academic.institutionId, classroomId: school.seed.classroomId, active: true });
    expect(e?.gradeLevelCode).toBeTruthy();
    const roster = await ports.students!.getClassroomRoster(w.director, school.seed.classroomId);
    expect(roster?.items.map((i) => i.studentId).sort()).toEqual(school.pupils.map((p) => p.studentId).sort());
    expect(roster?.institutionId).toBe(w.academic.institutionId);
    const id = await ports.students!.getIdentity(w.director, school.pupils[0]!.studentId);
    expect(id).toMatchObject({ lastName: school.pupils[0]!.lastName, firstName: "Prenom1", sex: "F", birthPlace: "Abidjan" });
    expect(id?.birthDate).toBe("2005-01-11");
    expect(await ports.students!.getEnrollment(w.director, newId())).toBeNull();
    expect(await ports.students!.getIdentity(w.director, newId())).toBeNull();
    expect(await ports.students!.getClassroomRoster(w.director, newId())).toBeNull();
  });

  it("établissements et liens de tutelle : un inconnu n'a aucun droit (échec fermé)", async () => {
    const ports = w.ports.examinations;
    expect(await ports.institutions!.exists(w.director, w.academic.institutionId)).toBe(true);
    expect(await ports.institutions!.exists(w.director, newId())).toBe(false);
    expect(await ports.institutions!.nameOf(w.director, w.academic.institutionId)).toBeTruthy();
    const stranger = newId();
    expect(await ports.family!.studentIdForUser(w.director, stranger)).toBeNull();
    expect(await ports.family!.childrenOf(w.director, stranger)).toEqual([]);
    expect(await ports.family!.isGuardianOf(w.director, stranger, school.pupils[0]!.studentId)).toBe(false);
  });

  it("faits d'éligibilité : interface d'academic ABSENTE -> échec fermé citant l'interface attendue ; stub conforme -> faits", async () => {
    const missing = createExaminationsEligibilityFacts(w.kit, { academicApi: {} });
    const r = await missing.getEligibilityFacts(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, studentId: school.pupils[0]!.studentId, examGradeLevelCode: "L1", referenceDate: "2026-06-01" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(ExamCode.PORT_UNAVAILABLE);
      expect(JSON.stringify(r.error.details)).toContain("academic.getEligibilityFacts");
    }
    const wrongShape = createExaminationsEligibilityFacts(w.kit, { academicApi: { getEligibilityFacts: async () => ({ ok: true, value: {} }) } });
    expect((await wrongShape.getEligibilityFacts(w.director, { enrollmentId: "e", studentId: school.pupils[0]!.studentId, examGradeLevelCode: "L1", referenceDate: null })).ok).toBe(false);
    const stub = createExaminationsEligibilityFacts(w.kit, { academicApi: { getEligibilityFacts: async () => ({ ok: true, value: { gradeLevelCode: "L1" } }) } });
    const ok = unwrap(await stub.getEligibilityFacts(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, studentId: school.pupils[0]!.studentId, examGradeLevelCode: "L1", referenceDate: "2026-06-01" }));
    expect(ok).toEqual({ inExamGrade: true, ageYears: 21 }); // né le 2005-01-11
    const other = unwrap(await stub.getEligibilityFacts(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, studentId: school.pupils[0]!.studentId, examGradeLevelCode: "L2", referenceDate: null }));
    expect(other).toEqual({ inExamGrade: false, ageYears: null });
    expect(ageAt("2005-06-10", "2026-06-09")).toBe(20);
    expect(ageAt("2005-06-10", "2026-06-10")).toBe(21);
    expect(ageAt(null, "2026-06-10")).toBeNull();
  });

  it("faits d'éligibilité : l'API RÉELLE d'academic est branchée (plus de port_unavailable) ; inscription inconnue : échec fermé", async () => {
    const real = w.ports.examinations.eligibility!;
    const facts = unwrap(await real.getEligibilityFacts(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, studentId: school.pupils[0]!.studentId, examGradeLevelCode: "L1", referenceDate: "2026-06-01" }));
    expect(facts.ageYears).toBe(21);
    expect(typeof facts.inExamGrade).toBe("boolean");
    const other = unwrap(await real.getEligibilityFacts(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, studentId: school.pupils[0]!.studentId, examGradeLevelCode: null, referenceDate: null }));
    expect(other).toEqual({ inExamGrade: false, ageYears: null });
    const unknown = await real.getEligibilityFacts(w.director, { enrollmentId: newId(), studentId: school.pupils[0]!.studentId, examGradeLevelCode: "L1", referenceDate: null });
    expect(unknown.ok).toBe(false);
  });

  it("documents officiels : jamais d'exception ni de document « presque officiel » (échec fermé tant que les natures d'examen manquent)", async () => {
    const reportcards = createOfficialDocumentDeps(w.kit, null);
    const port = createExaminationsOfficialDocuments(reportcards);
    const r = await port.request(w.director, { kind: "EXAM_CONVOCATION", sourceId: newId(), title: "Convocation", issuedAt: new Date(), institutionId: w.academic.institutionId, content: {}, context: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code === ExamCode.PORT_UNAVAILABLE || r.error.code.startsWith("reportcards.")).toBe(true);
    const read = await port.read(w.director, { documentId: newId(), kind: "EXAM_CONVOCATION", sourceId: newId() });
    expect(read.ok === false || read.value === null).toBe(true);
  });

  it("notes publiées d'assess : description de l'évaluation et notes par élève (jamais un brouillon)", async () => {
    const node = school.seed.ue1.ecueIds[0]!;
    const a = await publishAssessment(w, school, { typeCode: "EXAMEN", nodeId: node, scores: ["12", "7.5", null] });
    const ports = w.ports.examinations;
    const facts = await ports.assess!.getAssessment(w.director, a.id);
    expect(facts).toMatchObject({ assessmentId: a.id, classroomId: school.seed.classroomId, typeCode: "EXAMEN", published: true });
    const grades = await ports.assess!.listPublishedGrades(w.director, { classroomId: school.seed.classroomId, assessmentId: a.id });
    expect(grades).toHaveLength(3);
    expect(grades.filter((g) => g.entryStatus === "ENTERED").map((g) => g.score).sort()).toEqual(["12.000", "7.500"]); // décimaux exacts d'assess ; `examinations` les normalise (mapAssessEntry)
    expect(await ports.assess!.getAssessment(w.director, newId())).toBeNull();
  });

  it("chaîne complète sur les vrais modules : sélection de la classe, éligibilité manuelle (aucune règle liée), inscription, état civil figé depuis people", async () => {
    const d = deps();
    const grade = (await w.ports.examinations.students!.getClassroomRoster(w.director, school.seed.classroomId))!.gradeLevelCode as string;
    const type = unwrap(await createExamType(d, w.director, { code: "TESTX", label: "Examen d'essai (fictif)", educationLevelCode: "HIGHER", gradeLevelCode: grade, sourceKind: "placeholder" }));
    unwrap(await createPaper(d, w.director, type.id, { code: "P1", label: "Épreuve (fictive)", coefficient: "1", scaleMax: "20", isOptional: false, ordinal: 1, sourceKind: "placeholder" }));
    const session = unwrap(await createSession(d, w.director, { examTypeId: type.id, institutionId: w.academic.institutionId, code: "TESTX-1", label: "Session d'essai", sessionKind: "OFFICIAL", attemptKind: "NORMAL", sessionYear: 2027, sourceKind: "placeholder" }));
    unwrap(await instantiateSession(d, w.director, session.id));
    unwrap(await transitionSession(d, w.director, session.id, "REGISTRATION_OPEN"));
    const report = unwrap(await createFromClassroom(d, w.director, session.id, { classroomId: school.seed.classroomId }));
    expect(report).toMatchObject({ created: 3, failed: [] });
    const list = unwrap(await listCandidates(d, w.director, session.id, { page: 1, pageSize: 20 }));
    expect(list.items.map((c) => c.displayName).sort()).toEqual(school.pupils.map((p) => `${p.lastName} Prenom${p.lastName.slice(-1)}`).sort());
    const first = list.items[0]!;
    // sans règle épinglée : l'évaluation automatique est refusée, la saisie manuelle (avec auteur) reste possible
    const pinned = session.ruleVersionRef !== null;
    if (!pinned) {
      const auto = await evaluateEligibility(d, w.director, first.id, { mode: "EVALUATE" });
      expect(auto.ok).toBe(false);
      unwrap(await evaluateEligibility(d, w.director, first.id, { mode: "MANUAL", result: "ELIGIBLE", reasons: [] }));
      const registered = unwrap(await registerCandidate(d, w.director, first.id));
      expect(registered.candidateNumber).toBe("TESTX2027-00001");
      const detail = unwrap(await getCandidateDetail(d, w.director, first.id));
      expect(detail.candidate).toMatchObject({ registrationStatus: "REGISTERED", birthPlace: "Abidjan", birthDate: expect.stringMatching(/^2005-/), sex: expect.stringMatching(/^[FM]$/) });
    }
  });
});
