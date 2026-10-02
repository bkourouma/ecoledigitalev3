/**
 * Génération du jeu de données de charge : TOUT passe par HTTP avec de vrais comptes IAM (même parcours que `phase3/secondary`),
 * donc par les vraies règles, gardes et déclencheurs. Un tenant = un établissement SECONDARY, N classes, M élèves inscrits, une
 * facture de scolarité émise par élève, des notes PUBLIÉES (circuit complet), des parents avec compte de portail.
 *
 * Les durées de création (élèves, inscriptions, factures) sont elles-mêmes mesurées (`seedStats`) : ce sont des écritures réelles.
 */
import { expect } from "vitest";
import { waitFor } from "../../phase1/support/harness";
import { loginWithMfaEnrollment, provisionByConsole, redeemInvitation, type ProvisionedOwner } from "../../phase1/support/scenario";
import { activatePortalAccount, actorFrom, expectStatus, onboardStaffMember, type Actor } from "../../phase2/support/actors";
import { PLACEHOLDER_EFFECTIVE_FROM as PLACEHOLDER_RULES_START } from "../../../src/modules/rules/seed/rulesets";
import { addDays, isoDay } from "../../phase3/support/admissions";
import { CLASS_SIZE, STUDENTS_PER_TENANT, log } from "../config";
import { resetIpLimiters, type LoadEnv } from "./platform";
import { drive, type ScenarioStats } from "./stats";

export const SUBJECTS: Array<[string, string]> = [
  ["MATHS", "3"],
  ["FRANCAIS", "2"],
  ["SCIENCES", "2"],
  ["HISTOIRE", "1"],
];

export interface ClassWorld {
  id: string;
  code: string;
  studentIds: string[];
  enrollmentIds: string[];
  /** Évaluations PUBLIÉES (circuit complet), utilisées par les résultats et les bulletins. */
  publishedAssessmentIds: string[];
  /** Évaluations en BROUILLON (une par matière), pour la mesure de la saisie de notes en lot. */
  draftAssessments: Array<{ id: string; subject: string }>;
}

export interface ParentWorld {
  actor: Actor;
  email: string;
  studentIds: string[];
}

export interface TenantWorld {
  index: number;
  T: ProvisionedOwner;
  owner: Actor;
  directeur: Actor;
  pedago: Actor;
  teacher: Actor;
  yearId: string;
  yearCode: string;
  yearStart: string;
  periodIds: string[];
  nodeBySubject: Record<string, { nodeId: string; nodeId2: string }>;
  classes: ClassWorld[];
  studentIds: string[];
  invoiceByStudent: Map<string, string>;
  enrollmentByStudent: Map<string, string>;
  parents: ParentWorld[];
  feeIds: { tuition: string };
  ownerPassword: string;
  /** Mesures des écritures de génération. */
  seedStats: ScenarioStats[];
}

const SYL = ["ba", "ko", "di", "mu", "re", "sa", "to", "vi", "ne", "fo", "ga", "lu", "pe", "zo", "hi", "ka"];
/** Mot pseudo-aléatoire DÉTERMINISTE de 3 syllabes à partir d'un entier (suffisamment dispersé pour limiter les faux doublons). */
function word(n: number, salt: number): string {
  let x = (n * 2654435761 + salt * 40503) >>> 0;
  let out = "";
  for (let i = 0; i < 3; i += 1) {
    out += SYL[x % SYL.length];
    x = Math.imul(x ^ (x >>> 7), 0x9e3779b1) >>> 0;
  }
  return out.charAt(0).toUpperCase() + out.slice(1) + String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + ((n >> 5) % 26));
}

export async function seedTenant(p: LoadEnv, index: number, password: string): Promise<TenantWorld> {
  const slug = `charge${index + 1}`;
  const today = isoDay(new Date());
  const seedStats: ScenarioStats[] = [];
  await resetIpLimiters(["reset:ip", "forgot:ip", "login:ip"]);

  // ---- (1) provisionnement, abonnement, comptes ------------------------------------------------------------------
  const T = await provisionByConsole(p, { name: `Collège Charge ${index + 1}`, slug, packs: ["SECONDARY"], ownerEmail: `owner@${slug}.test` });
  expectStatus(await p.http("PUT", `/api/v1/platform/tenants/${T.tenantId}/subscription`, { token: p.operatorToken, body: { planKey: "PROFESSIONAL", packs: ["SECONDARY"], status: "ACTIVE" } }), 200);
  await redeemInvitation(p, T.ownerEmail);
  const owner = actorFrom(p.http, "owner", T.ownerEmail, await loginWithMfaEnrollment(p, T.ownerEmail, T.slug));
  const directeur = await onboardStaffMember(p, owner, T.slug, `directeur@${slug}.test`, "directeur");
  const pedago = await onboardStaffMember(p, owner, T.slug, `pedagogie@${slug}.test`, "responsable_pedagogique");

  const levels = await waitFor(
    async () => {
      const r = await owner.get("/api/v1/academic/reference/grade-levels");
      const items = r.body.items as Array<{ id: string; code: string }>;
      return items.some((g) => g.code === "3E") ? items : false;
    },
    { label: "niveaux du pack", timeoutMs: 90_000 },
  );
  const gradeLevelId = levels.find((g) => g.code === "3E")!.id;
  const fees = await waitFor(
    async () => {
      const r = await owner.get("/api/v1/finance/fees");
      const items = r.body.items as Array<{ id: string; code: string }>;
      return items.some((f) => f.code === "TUITION") ? items : false;
    },
    { label: "frais du pack", timeoutMs: 90_000 },
  );
  const tuitionFee = fees.find((f) => f.code === "TUITION")!.id;
  await waitFor(
    async () => {
      const r = await owner.get("/api/v1/rules/bindings");
      const items = (r.body.items ?? r.body) as Array<{ contractId: string }>;
      return items.some((b) => b.contractId === "secondary-annual@1") ? items : false;
    },
    { label: "liaisons de règles du pack", timeoutMs: 90_000 },
  );

  // ---- (2) année, curriculum, classes ----------------------------------------------------------------------------
  const yearStart = [addDays(today, -120), PLACEHOLDER_RULES_START].sort().at(-1) as string;
  const yearCode = `${yearStart.slice(0, 4)}-${addDays(yearStart, 364).slice(0, 4)}`;
  const y = await owner.post("/api/v1/academic/years", { institutionId: T.institutionId, code: yearCode, label: "Année de charge", startsOn: yearStart }, 201);
  const yearId = y.body.id as string;
  await owner.post(`/api/v1/academic/years/${yearId}/open`);
  await owner.post(`/api/v1/academic/years/${yearId}/set-current`);
  const plan = await owner.post(`/api/v1/academic/years/${yearId}/period-plan`, { planCode: "TWO_SEMESTERS" }, 201);
  const periodIds = (plan.body.items as Array<{ id: string }>).map((x) => x.id);
  await owner.post(`/api/v1/academic/periods/${periodIds[0]}/open`);
  expect((await owner.put(`/api/v1/academic/institutions/${T.institutionId}/settings`, { enrollmentConfirmationPolicy: "AUTO" })).body.enrollmentConfirmationPolicy).toBe("AUTO");
  await owner.post("/api/v1/finance/fee-schedules", { feeId: tuitionFee, academicYear: yearCode, amount: 500000, effectiveFrom: "2020-01-01" }, 201);

  const programs = await owner.get(`/api/v1/academic/programs?institutionId=${T.institutionId}`);
  const programId = (programs.body.items as Array<{ id: string; code: string }>).find((x) => x.code === "COLLEGE")!.id;
  const subjectIds: Record<string, string> = {};
  for (const [code] of SUBJECTS) subjectIds[code] = (await owner.post("/api/v1/academic/subjects", { institutionId: T.institutionId, code, label: `Matière ${code}` }, 201)).body.id;
  const version = await owner.post("/api/v1/academic/curriculum-versions", { programId, academicYearId: yearId }, 201);
  const versionId = version.body.id as string;
  const node = async (body: Record<string, unknown>): Promise<any> => (await owner.post(`/api/v1/academic/curriculum-versions/${versionId}/nodes`, body, 201)).body;
  const level = await node({ nodeTypeCode: "LEVEL", code: "3E", label: "Troisième", gradeLevelId });
  const s1 = await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
  const s2 = await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S2", label: "Semestre 2", periodTypeCode: "SEMESTER", periodOrdinal: 2 });
  const nodeBySubject: TenantWorld["nodeBySubject"] = {};
  for (const [code, coef] of SUBJECTS) {
    const a = await node({ parentId: s1.id, nodeTypeCode: "SUBJECT", code: `${code}1`, label: `${code} S1`, subjectId: subjectIds[code], coefficient: coef });
    const b = await node({ parentId: s2.id, nodeTypeCode: "SUBJECT", code: `${code}2`, label: `${code} S2`, subjectId: subjectIds[code], coefficient: coef });
    nodeBySubject[code] = { nodeId: a.id, nodeId2: b.id };
  }
  expect((await owner.post(`/api/v1/academic/curriculum-versions/${versionId}/publish`)).body.status).toBe("PUBLISHED");

  const classCount = Math.max(1, Math.ceil(STUDENTS_PER_TENANT / CLASS_SIZE));
  const classes: ClassWorld[] = [];
  for (let c = 0; c < classCount; c += 1) {
    const code = `3E-${String.fromCharCode(65 + (c % 26))}${c >= 26 ? Math.floor(c / 26) : ""}`;
    const r = await owner.post(
      "/api/v1/academic/classrooms",
      { institutionId: T.institutionId, academicYearId: yearId, programId, gradeLevelId, curriculumVersionId: versionId, code, name: `Troisième ${code}`, capacity: CLASS_SIZE + 10 },
      201,
    );
    const activated = await owner.post(`/api/v1/academic/classrooms/${r.body.id}/activate`, {});
    expect(activated.status).toBeLessThan(300);
    classes.push({ id: r.body.id, code, studentIds: [], enrollmentIds: [], publishedAssessmentIds: [], draftAssessments: [] });
  }

  // ---- (3) enseignant affecté à toutes les classes ----------------------------------------------------------------
  const cats = await owner.get("/api/v1/people/reference/staff-categories");
  const teacherCat = (cats.body.items as Array<{ code: string; canTeach: boolean }>).find((c) => c.canTeach);
  const staff = await owner.post(
    "/api/v1/people/staff",
    { person: { lastName: "PROFESSEUR", firstName: "Charge", sex: "M", birthDate: "1985-04-04", email: `prof@${slug}.test` }, categoryCode: teacherCat!.code, hiredOn: "2020-09-01" },
    201,
  );
  const staffId = (staff.body.staff?.id ?? staff.body.id) as string;
  expect((await owner.post(`/api/v1/people/staff/${staffId}/portal-invitation`, { role: "enseignant" }, [200, 201])).body.invited).toBe(true);
  const teacher = await activatePortalAccount(p, T.slug, `prof@${slug}.test`, "enseignant");
  for (const cl of classes) {
    for (const [code] of SUBJECTS) {
      for (const nodeId of [nodeBySubject[code]!.nodeId, nodeBySubject[code]!.nodeId2]) {
        await owner.post("/api/v1/people/teaching-assignments", { staffId, academicYearId: yearId, classroomId: cl.id, curriculumNodeId: nodeId, roleCode: "LEAD", startsOn: yearStart }, 201);
      }
    }
  }

  // ---- (4) élèves (écritures MESURÉES), inscriptions en lot, factures ----------------------------------------------
  const studentIds: string[] = [];
  let dupRetries = 0;
  const created = await drive({
    name: "seed.people.students.create",
    what: "POST /people/students (détection de doublons incluse)",
    concurrency: 6,
    total: STUDENTS_PER_TENANT,
    op: async (i) => {
      const person = { lastName: word(i + index * 100_003, 1).toUpperCase(), firstName: word(i + index * 100_003, 2), sex: i % 2 ? "F" : "M", birthDate: `${2008 + (i % 4)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}` };
      let r = await owner.raw("POST", "/api/v1/people/students", { person });
      if (r.status === 409 || r.status === 422) {
        dupRetries += 1;
        r = await owner.raw("POST", "/api/v1/people/students", { person, acknowledgeDuplicate: true, duplicateReason: "Jeu de données de charge." });
      }
      if (r.status === 201) studentIds[i] = r.body.student.id as string;
      return { status: r.status, note: JSON.stringify(r.body)?.slice(0, 200) };
    },
  });
  seedStats.push(created);
  if (dupRetries) log(`tenant ${index + 1} : ${dupRetries} homonymes confirmés explicitement`);
  expect(created.errors, JSON.stringify(created.samples)).toBe(0);
  const ids = studentIds.filter(Boolean);
  expect(ids).toHaveLength(STUDENTS_PER_TENANT);

  const enrollmentByStudent = new Map<string, string>();
  const enrollT0 = performance.now();
  for (const [c, cl] of classes.entries()) {
    const slice = ids.filter((_, i) => i % classes.length === c);
    const r = await owner.post("/api/v1/academic/enrollments/bulk", { items: slice.map((studentId) => ({ studentId, classroomId: cl.id, enrolledOn: yearStart })) }, 201);
    expect(r.body.failed, JSON.stringify(r.body.failed?.slice?.(0, 2))).toHaveLength(0);
    for (const e of r.body.created as Array<{ id: string; studentId: string }>) {
      enrollmentByStudent.set(e.studentId, e.id);
      cl.studentIds.push(e.studentId);
      cl.enrollmentIds.push(e.id);
    }
  }
  log(`tenant ${index + 1} : ${enrollmentByStudent.size} inscriptions en ${Math.round(performance.now() - enrollT0)} ms (lots de ${CLASS_SIZE})`);

  const invoiceByStudent = new Map<string, string>();
  const invoices = await drive({
    name: "seed.finance.invoices.from-schedule",
    what: "POST /finance/invoices/from-schedule (scolarité, émise)",
    concurrency: 6,
    total: ids.length,
    op: async (i) => {
      const studentId = ids[i] as string;
      const r = await owner.raw(
        "POST",
        "/api/v1/finance/invoices/from-schedule",
        { learnerId: studentId, enrollmentId: enrollmentByStudent.get(studentId), academicYear: yearCode, items: [{ feeCode: "TUITION" }], issue: true },
        { "idempotency-key": `ld-${slug}-inv-${i}` },
      );
      if (r.status === 200 || r.status === 201) invoiceByStudent.set(studentId, r.body.invoices[0].id as string);
      return { status: r.status, note: JSON.stringify(r.body)?.slice(0, 200) };
    },
  });
  seedStats.push(invoices);
  expect(invoices.errors, JSON.stringify(invoices.samples)).toBe(0);

  // ---- (5) notes : circuit complet jusqu'à PUBLIÉ + brouillons pour la mesure ------------------------------------------
  const types = await waitFor(
    async () => {
      const r = await teacher.get("/api/v1/assess/assessment-types");
      const items = r.body.items as Array<{ id: string; code: string }>;
      return items.length > 0 ? items : false;
    },
    { label: "types d'évaluation", timeoutMs: 90_000 },
  );
  const typeId = (code: string): string => types.find((t) => t.code === code)!.id;
  const assessedOn = addDays(yearStart, 10);
  const score = (i: number, k: number): string => String(4 + ((i * 7 + k * 13) % 15));
  const gradesT0 = performance.now();
  for (const cl of classes) {
    for (const [k, type] of ["DEVOIR", "COMPOSITION"].entries()) {
      const r = await teacher.post(
        "/api/v1/assess/assessments/bulk",
        { typeId: typeId(type), academicPeriodId: periodIds[0], title: `${type} S1 ${cl.code}`, assessedOn, targets: SUBJECTS.map(([s]) => ({ classroomId: cl.id, curriculumNodeId: nodeBySubject[s]!.nodeId })) },
        201,
      );
      for (const it of r.body.items as Array<{ id: string }>) {
        const entries = cl.enrollmentIds.map((enrollmentId, i) => ({ enrollmentId, score: score(i, k) }));
        await teacher.put(`/api/v1/assess/assessments/${it.id}/grades`, { entries }, 200, { "idempotency-key": `ld-${slug}-g-${it.id}` });
        await teacher.post(`/api/v1/assess/assessments/${it.id}/transitions`, { to: "SUBMITTED" });
        await pedago.post(`/api/v1/assess/assessments/${it.id}/transitions`, { to: "REVIEWED" });
        await pedago.post(`/api/v1/assess/assessments/${it.id}/transitions`, { to: "APPROVED" });
        await directeur.post(`/api/v1/assess/assessments/${it.id}/transitions`, { to: "PUBLISHED" });
        cl.publishedAssessmentIds.push(it.id);
      }
    }
    // Brouillons : une évaluation par matière, notes saisies pendant la mesure.
    const drafts = await teacher.post(
      "/api/v1/assess/assessments/bulk",
      { typeId: typeId("DEVOIR"), academicPeriodId: periodIds[0], title: `Charge ${cl.code}`, assessedOn: addDays(yearStart, 11), targets: SUBJECTS.map(([s]) => ({ classroomId: cl.id, curriculumNodeId: nodeBySubject[s]!.nodeId })) },
      201,
    );
    for (const it of drafts.body.items as Array<{ id: string; curriculumNodeId: string }>) {
      cl.draftAssessments.push({ id: it.id, subject: SUBJECTS.find(([s]) => nodeBySubject[s]!.nodeId === it.curriculumNodeId)![0] });
    }
  }
  log(`tenant ${index + 1} : ${classes.length * 8} évaluations publiées (${classes.length * 8 * (classes[0]?.enrollmentIds.length ?? 0)} notes) en ${Math.round(performance.now() - gradesT0)} ms`);

  // ---- (6) parents avec compte de portail (2 enfants chacun) ---------------------------------------------------------
  const parents: ParentWorld[] = [];
  const parentCount = Math.min(3, Math.floor(ids.length / 2));
  for (let k = 0; k < parentCount; k += 1) {
    const email = `parent${k + 1}@${slug}.test`;
    const g = await owner.post("/api/v1/people/guardians", { person: { lastName: word(k + 777 + index * 31, 3).toUpperCase(), firstName: word(k + 777, 4), sex: "F", email, phone: `+2250700${index}${k}0000`, birthDate: "1980-01-01" } }, 201);
    const guardianId = (g.body.guardian?.id ?? g.body.id) as string;
    const kids = [ids[k * 2] as string, ids[k * 2 + 1] as string];
    for (const sid of kids) {
      await owner.post(`/api/v1/people/students/${sid}/guardians`, { guardianId, relationshipCode: "MOTHER", isPrimaryContact: true, isFinancialResponsible: true, portalAccess: true }, [200, 201]);
    }
    const links = await owner.get(`/api/v1/people/students/${kids[0]}/guardians`);
    const first = (links.body.items as Array<{ personId?: string; guardian?: { personId: string } }>)[0] as { personId?: string; guardian?: { personId: string } };
    const personId = first.personId ?? first.guardian?.personId;
    expect((await owner.post(`/api/v1/people/persons/${personId}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201])).body.invited).toBe(true);
    const actor = await activatePortalAccount(p, T.slug, email, "parent");
    parents.push({ actor, email, studentIds: kids });
  }

  return {
    index,
    T,
    owner,
    directeur,
    pedago,
    teacher,
    yearId,
    yearCode,
    yearStart,
    periodIds,
    nodeBySubject,
    classes,
    studentIds: ids,
    invoiceByStudent,
    enrollmentByStudent,
    parents,
    feeIds: { tuition: tuitionFee },
    ownerPassword: password,
    seedStats,
  };
}
