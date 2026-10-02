/**
 * Scénario du seed : un établissement de démonstration COMPLET, créé uniquement par l'API HTTP publique (aucun SQL direct).
 *
 *   1 console : organisation + abonnement ; direction, pédagogie     2 année, périodes, programme, curriculum publié, classe
 *   3 élèves, tuteurs, enseignants, comptes de portail              4 frais, inscriptions, factures, règlements (confirmation par événement)
 *   5 emploi du temps et séances                                     6 appels                       7 évaluations et notes publiées
 *
 * Le jeu de données vient de `dataset.ts` (fonction pure d'une graine). Le scénario est le même pour les trois packs ; seul le
 * curriculum diffère (HIGHER : UE/ECUE crédités ; PRIMARY et SECONDARY : matières coefficientées sous le niveau). Les résultats
 * calculés par `rules` (moyennes, délibérations) ne sont créés que pour HIGHER ; PRIMARY/SECONDARY s'arrêtent aux notes publiées.
 */
import { createHash } from "node:crypto";
import { Accounts, SeedStepError, expectStatus } from "./actors";
import { addDays, type SeedDataset } from "./dataset";
import { waitFor, type SeedPlatform } from "./runtime";

export interface SeedReport {
  alreadySeeded: boolean;
  slug: string;
  pack: string;
  tenantId: string | null;
  /** Ce que le pack propose (ou non) en plus de la structure : affiché à l'opérateur. */
  notes: string[];
  counts: Record<string, number>;
  /** Empreinte des données MÉTIER (noms, numéros, montants, statuts) : identique d'une exécution à l'autre, d'un tenant à l'autre. */
  fingerprint: string | null;
  /** Comptes de test créés (mots de passe générés à l'exécution : à afficher UNE fois, jamais à journaliser). */
  accounts: Array<{ role: string; email: string; password: string; totpSecret?: string }>;
}

type Log = (line: string) => void;

const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export async function runScenario(platform: SeedPlatform, data: SeedDataset, log: Log): Promise<SeedReport> {
  const { http } = platform;
  const step = (name: string): void => log(`• ${name}`);

  // ------------------------------------------------------------------------------------------------ 0. déjà présent ?
  const found = await http("GET", `/api/v1/platform/tenants?search=${encodeURIComponent(data.slug)}&limit=50`, { token: platform.operatorToken });
  expectStatus(found, 200, "recherche du tenant");
  const existing = (found.body.items as Array<{ slug: string; id: string }>).find((t) => t.slug === data.slug);
  if (existing) {
    return { alreadySeeded: true, slug: data.slug, pack: data.pack, tenantId: existing.id, notes: ["Le tenant existe déjà : rien n'a été créé ni modifié (seed idempotent)."], counts: {}, fingerprint: null, accounts: [] };
  }

  // ------------------------------------------------------------------------------------------------ 1. console
  step(`console : organisation « ${data.tenantName} » (pack ${data.pack}), abonnement PROFESSIONAL`);
  const provisioned = expectStatus(
    await http("POST", "/api/v1/platform/tenants", {
      token: platform.operatorToken,
      body: { name: data.tenantName, slug: data.slug, countryCode: "CI", packs: [data.pack], adminContact: { name: "Direction générale (démo)", email: data.accounts.owner, phone: "+225 07 00 00 00 00" } },
    }),
    201,
    "provisionnement",
  ).body;
  const tenantId = provisioned.tenantId as string;
  const institutionId = provisioned.institutions[0].id as string;
  expectStatus(
    await http("PUT", `/api/v1/platform/tenants/${tenantId}/subscription`, { token: platform.operatorToken, body: { planKey: "PROFESSIONAL", packs: [data.pack], status: "ACTIVE" } }),
    200,
    "abonnement",
  );

  const accounts = new Accounts(http, platform.invitations, data.slug);
  step("comptes : propriétaire (MFA), direction, responsable pédagogique");
  const owner = await accounts.owner("proprietaire", data.accounts.owner);
  const directeur = await accounts.staff(owner, "directeur", data.accounts.directeur, "directeur");
  const pedago = await accounts.staff(owner, "responsable_pedagogique", data.accounts.pedagogie, "responsable_pedagogique");

  // ------------------------------------------------------------------------------------------------ 2. structure
  step("référentiels du pack (instanciés par le worker)");
  const gradeLevels = await waitFor(
    async () => {
      const r = await owner.get("/api/v1/academic/reference/grade-levels");
      const items = r.body.items as Array<{ id: string; code: string }>;
      return items.some((g) => g.code === data.gradeLevelCode) ? items : false;
    },
    { label: `niveaux du pack ${data.pack}`, timeoutMs: 60_000 },
  );
  const gradeLevelId = gradeLevels.find((g) => g.code === data.gradeLevelCode)!.id;
  const educationLevels = (await owner.get("/api/v1/academic/reference/education-levels")).body.items as Array<{ id: string; code: string }>;
  const educationLevelId = educationLevels.find((l) => l.code === data.educationLevelCode)?.id;
  if (!educationLevelId) throw new SeedStepError(`Niveau d'enseignement introuvable : ${data.educationLevelCode}`);

  await owner.put(`/api/v1/academic/institutions/${institutionId}/settings`, {
    enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID",
    registrationNumberPrefix: "DEMO",
    registrationNumberPattern: "{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}",
  });

  step(`année ${data.yearCode} (courante), plan de périodes ${data.periodPlan}`);
  const year = (await owner.post("/api/v1/academic/years", { institutionId, code: data.yearCode, label: `Année scolaire ${data.yearCode}`, startsOn: data.yearStart }, 201)).body;
  const yearId = year.id as string;
  await owner.post(`/api/v1/academic/years/${yearId}/open`);
  await owner.post(`/api/v1/academic/years/${yearId}/set-current`);
  const plan = await owner.post(`/api/v1/academic/years/${yearId}/period-plan`, { planCode: data.periodPlan }, 201);
  const periodIds = (plan.body.items as Array<{ id: string }>).map((p) => p.id);
  await owner.post(`/api/v1/academic/periods/${periodIds[0]}/open`);

  step(`programme ${data.programCode}, matières, curriculum ${data.gradeLevelCode} publié`);
  let programId: string | undefined;
  const programs = await owner.raw("GET", `/api/v1/academic/programs?institutionId=${institutionId}`);
  if (programs.status === 200) programId = (programs.body.items as Array<{ id: string; code: string }>).find((p) => p.code === data.programCode)?.id;
  if (!programId) {
    programId = (await owner.post("/api/v1/academic/programs", { institutionId, educationLevelId, code: data.programCode, label: data.programLabel, gradeLevelIds: [gradeLevelId] }, 201)).body.id as string;
  }
  const subjectIds: string[] = [];
  for (const s of data.subjects) {
    subjectIds.push((await owner.post("/api/v1/academic/subjects", { institutionId, code: s.code, label: s.label }, 201)).body.id as string);
  }
  const version = (await owner.post("/api/v1/academic/curriculum-versions", { programId, academicYearId: yearId }, 201)).body;
  const versionId = version.id as string;
  const addNode = async (body: Record<string, unknown>): Promise<{ id: string; lineageId: string }> =>
    (await owner.post(`/api/v1/academic/curriculum-versions/${versionId}/nodes`, body, 201)).body;
  const level = await addNode({ nodeTypeCode: "LEVEL", code: data.gradeLevelCode, label: data.classroomName, gradeLevelId });
  /** Nœuds évaluables (ECUE en HIGHER, matières ailleurs), dans l'ordre des matières. */
  const teachable: string[] = [];
  if (data.pack === "HIGHER") {
    const period = await addNode({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
    for (let u = 0; u < 2; u += 1) {
      const pair = data.subjects.slice(u * 2, u * 2 + 2);
      const credits = pair.reduce((n, s) => n + Number(s.credits), 0);
      const ue = await addNode({ parentId: period.id, nodeTypeCode: "UE", code: `UE${u + 1}`, label: `UE ${u + 1}`, credits: String(credits) });
      for (const [k, s] of pair.entries()) {
        const ecue = await addNode({ parentId: ue.id, nodeTypeCode: "ECUE", code: `E${u + 1}${k + 1}`, label: s.label, subjectId: subjectIds[u * 2 + k], credits: s.credits, coefficient: s.coefficient, resitAllowed: true });
        teachable.push(ecue.id);
      }
    }
  } else {
    for (const [i, s] of data.subjects.entries()) {
      const node = await addNode({ parentId: level.id, nodeTypeCode: "SUBJECT", code: s.code, label: s.label, subjectId: subjectIds[i], coefficient: s.coefficient });
      teachable.push(node.id);
    }
  }
  const check = await owner.get(`/api/v1/academic/curriculum-versions/${versionId}/validate`);
  if (/"severity":"error"/.test(JSON.stringify(check.body))) throw new SeedStepError(`Curriculum invalide : ${JSON.stringify(check.body).slice(0, 500)}`);
  await owner.post(`/api/v1/academic/curriculum-versions/${versionId}/publish`);

  const classroom = (
    await owner.post("/api/v1/academic/classrooms", { institutionId, academicYearId: yearId, programId, gradeLevelId, curriculumVersionId: versionId, code: data.classroomCode, name: data.classroomName, capacity: 40 }, 201)
  ).body;
  const classroomId = classroom.id as string;
  await owner.post(`/api/v1/academic/classrooms/${classroomId}/activate`, {});

  // ------------------------------------------------------------------------------------------------ 3. personnes
  step(`${data.students.length} élèves, ${data.guardians.length} tuteurs (fratries), ${data.teachers.length} enseignants`);
  const relationships = (await owner.get("/api/v1/people/reference/relationship-types")).body.items as Array<{ code: string }>;
  const relationshipCode = relationships[0]?.code as string;
  const guardianIds: string[] = [];
  const guardianPersonIds: string[] = [];
  for (const g of data.guardians) {
    const r = await owner.post("/api/v1/people/guardians", { person: { lastName: g.lastName, firstName: g.firstName, sex: g.sex, email: g.email, phone: g.phone } }, 201);
    guardianIds.push(r.body.guardian.id as string);
    guardianPersonIds.push(r.body.guardian.personId as string);
  }
  const students: Array<{ id: string; personId: string; studentNumber: string; enrollmentId?: string; registrationNumber?: string }> = [];
  for (const s of data.students) {
    const r = await owner.post("/api/v1/people/students", { person: { lastName: s.lastName, firstName: s.firstName, sex: s.sex, birthDate: s.birthDate, birthPlace: s.birthPlace } }, 201);
    const created = { id: r.body.student.id as string, personId: r.body.student.personId as string, studentNumber: r.body.student.studentNumber as string };
    students.push(created);
    await owner.post(
      `/api/v1/people/students/${created.id}/guardians`,
      { guardianId: guardianIds[s.guardian], relationshipCode, isPrimaryContact: true, isFinancialResponsible: true, hasLegalCustody: true, portalAccess: true },
      201,
    );
  }

  const categories = (await owner.get("/api/v1/people/reference/staff-categories")).body.items as Array<{ code: string; canTeach: boolean }>;
  const teacherCategory = categories.find((c) => c.canTeach);
  if (!teacherCategory) throw new SeedStepError("Aucune catégorie de personnel enseignant.");
  const teacherStaffIds: string[] = [];
  for (const t of data.teachers) {
    const r = await owner.post("/api/v1/people/staff", { person: { lastName: t.lastName, firstName: t.firstName, sex: t.sex, birthDate: t.birthDate, email: t.email }, categoryCode: teacherCategory.code, hiredOn: "2020-09-01" }, 201);
    teacherStaffIds.push((r.body.staff?.id ?? r.body.id) as string);
  }
  const leadStaffId = teacherStaffIds[0] as string;

  step("comptes de portail : enseignant, tuteur, élève");
  await owner.post(`/api/v1/people/staff/${leadStaffId}/portal-invitation`, { role: "enseignant" }, [200, 201]);
  const teacher = await accounts.portal("enseignant", data.accounts.enseignant);
  for (const staffId of teacherStaffIds) {
    await owner.post(
      "/api/v1/people/teaching-assignments",
      { staffId, academicYearId: yearId, classroomId, roleCode: staffId === leadStaffId ? "LEAD" : "CO_TEACHER", coversAllSubjects: true, startsOn: data.yearStart },
      [200, 201],
    );
  }
  await owner.post(`/api/v1/people/persons/${guardianPersonIds[0]}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201]);
  const parent = await accounts.portal("parent", data.accounts.parent);
  await owner.patch(`/api/v1/people/students/${students[0]!.id}`, { person: { email: data.accounts.eleve } });
  await owner.post(`/api/v1/people/persons/${students[0]!.personId}/portal-invitation`, { quality: "STUDENT" }, [200, 201]);
  const learner = await accounts.portal("eleve", data.accounts.eleve);

  // ------------------------------------------------------------------------------------------------ 4. finances et inscriptions
  step(`frais, inscriptions, factures ; ${data.paidCount} règlements (confirmation par événement)`);
  const registration = (await owner.post("/api/v1/finance/fees", { code: "INSC", name: "Frais d'inscription", category: "REGISTRATION" }, 201)).body;
  const tuition = (await owner.post("/api/v1/finance/fees", { code: "SCOL", name: "Scolarité annuelle", category: "TUITION" }, 201)).body;
  await owner.post("/api/v1/finance/fee-schedules", { feeId: registration.id, academicYear: data.yearCode, amount: data.registrationFee, effectiveFrom: "2020-01-01" }, 201);
  await owner.post("/api/v1/finance/fee-schedules", { feeId: tuition.id, academicYear: data.yearCode, amount: data.tuitionFee, effectiveFrom: "2020-01-01" }, 201);

  const key = (kind: string, i: number): string => `seed-${data.slug}-${kind}-${i + 1}`;
  const invoices: Array<{ kind: string; student: number; total: number; status: string }> = [];
  for (const [i, s] of students.entries()) {
    const e = (await owner.post("/api/v1/academic/enrollments", { studentId: s.id, classroomId, enrolledOn: data.yearStart }, 201)).body;
    s.enrollmentId = e.id as string;
    s.registrationNumber = e.registrationNumber as string;
    const inv = (
      await owner.post(
        "/api/v1/finance/invoices/from-schedule",
        { learnerId: s.id, enrollmentId: s.enrollmentId, academicYear: data.yearCode, items: [{ feeCode: "INSC" }], issue: true },
        [200, 201],
        { "idempotency-key": key("inv-insc", i) },
      )
    ).body.invoices[0];
    invoices.push({ kind: "INSC", student: i, total: inv.total.amount as number, status: inv.status as string });
    if (i >= data.paidCount) continue;
    await owner.post(
      "/api/v1/finance/payments",
      { learnerId: s.id, enrollmentId: s.enrollmentId, amount: data.registrationFee, method: "TRANSFER", reference: `VIR-DEMO-${String(i + 1).padStart(3, "0")}`, allocation: { mode: "AUTO", invoiceIds: [inv.id] } },
      [200, 201],
      { "idempotency-key": key("pay-insc", i) },
    );
    const tuitionInvoice = (
      await owner.post(
        "/api/v1/finance/invoices/from-schedule",
        { learnerId: s.id, enrollmentId: s.enrollmentId, academicYear: data.yearCode, items: [{ feeCode: "SCOL" }], issue: true },
        [200, 201],
        { "idempotency-key": key("inv-scol", i) },
      )
    ).body.invoices[0];
    invoices.push({ kind: "SCOL", student: i, total: tuitionInvoice.total.amount as number, status: tuitionInvoice.status as string });
  }
  const statusOf = async (enrollmentId: string): Promise<string> => (await owner.get(`/api/v1/academic/enrollments/${enrollmentId}`)).body.enrollment.status as string;
  for (const [i, s] of students.slice(0, data.paidCount).entries()) {
    await waitFor(async () => (await statusOf(s.enrollmentId!)) === "ACTIVE", { label: `confirmation de l'inscription ${i + 1}`, timeoutMs: 60_000 });
  }

  // ------------------------------------------------------------------------------------------------ 5. emploi du temps
  step("emploi du temps (un cours par matière, du lundi au jeudi), occurrences générées");
  const today = iso(new Date());
  const timetable = (
    await owner.post(
      "/api/v1/scheduling/timetables",
      { institutionId, academicYearId: yearId, name: `Emploi du temps ${data.classroomCode}`, validFrom: data.yearStart, validTo: data.yearEnd },
      201,
    )
  ).body;
  for (const [i, nodeId] of teachable.entries()) {
    await owner.post(
      `/api/v1/scheduling/timetables/${timetable.id}/entries`,
      { classroomId, curriculumNodeId: nodeId, weekday: i + 1, startTime: "08:00", endTime: "10:00", staff: [{ staffId: leadStaffId, role: "LEAD" }], title: data.subjects[i]!.label },
      201,
    );
  }
  await owner.post(`/api/v1/scheduling/timetables/${timetable.id}/publish`);
  const generated = await owner.post(`/api/v1/scheduling/timetables/${timetable.id}/generate`, { from: data.yearStart, to: addDays(today, 14) });
  const occurrenceList = await owner.get(`/api/v1/scheduling/occurrences?classroomId=${classroomId}&from=${data.yearStart}&to=${addDays(today, 14)}&limit=200`);
  const occurrences = occurrenceList.body.items as Array<{ id: string; startsAt: string }>;
  const past = occurrences.filter((o) => Date.parse(o.startsAt) < Date.now() - 3 * 3_600_000).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // ------------------------------------------------------------------------------------------------ 6. appels
  step("appels : deux séances passées pointées par l'enseignant, validées par la direction");
  const attendanceSessions: string[] = [];
  const attendanceNotes: string[] = [];
  const activeStudents = students.slice(0, data.paidCount);
  for (const [n, occ] of past.slice(0, 2).entries()) {
    const attempt = await teacher.raw("POST", "/api/v1/attendance/sessions", { occurrenceId: occ.id });
    if (attempt.status === 409 && attempt.body?.code === "attendance.call_scope_not_allowed") {
      // Maternelle et primaire : appel JOURNALIER (politique du cycle), pas d'appel par séance : rien à pointer ici.
      attendanceNotes.push(`${data.pack} : la politique d'appel du cycle est journalière (DAILY) : aucun appel par séance n'est créé.`);
      break;
    }
    const opened = expectStatus(attempt, [200, 201], "enseignant POST /api/v1/attendance/sessions");
    const sessionId = opened.body.session.id as string;
    await teacher.put(`/api/v1/attendance/sessions/${sessionId}/records`, {
      entries: activeStudents.map((s, i) => (i === 2 + n ? { studentId: s.id, statusCode: "ABSENT" } : i === 5 ? { studentId: s.id, statusCode: "LATE", minutesLate: 10 } : { studentId: s.id, statusCode: "PRESENT" })),
    });
    await teacher.post(`/api/v1/attendance/sessions/${sessionId}/submit`, {});
    await directeur.post(`/api/v1/attendance/sessions/${sessionId}/validate`, {});
    attendanceSessions.push(sessionId);
  }

  // ------------------------------------------------------------------------------------------------ 7. évaluations
  step("évaluations : deux contrôles par matière évaluée, notes saisies, relues, validées, publiées");
  const types = await waitFor(
    async () => {
      const r = await teacher.get("/api/v1/assess/assessment-types");
      const items = r.body.items as Array<{ id: string; code: string }>;
      return items.length > 0 ? items : false;
    },
    { label: "types d'évaluation", timeoutMs: 60_000 },
  );
  const typeId = (types.find((t) => t.code === "DEVOIR") ?? types[0])!.id;
  const periods = (await owner.get(`/api/v1/academic/years/${yearId}/periods`)).body.items as Array<{ id: string; startsOn: string }>;
  const firstPeriod = periods.find((p) => p.id === periodIds[0])!;
  const assessedOn = addDays(firstPeriod.startsOn, 10) > today ? today : addDays(firstPeriod.startsOn, 10);
  const targets = teachable.slice(0, 2);
  const created = await teacher.post(
    "/api/v1/assess/assessments/bulk",
    { typeId, academicPeriodId: periodIds[0], title: "Premier contrôle", assessedOn, targets: targets.map((curriculumNodeId) => ({ classroomId, curriculumNodeId })) },
    201,
  );
  const grades: Array<{ assessment: number; student: number; score: string }> = [];
  for (const [a, assessment] of (created.body.items as Array<{ id: string }>).entries()) {
    const entries = activeStudents.map((s, i) => {
      // Notes déterministes : fonction de (matière, élève) seulement.
      const score = String(8 + ((a * 7 + i * 5 + data.seed) % 11));
      grades.push({ assessment: a, student: i, score });
      return { enrollmentId: s.enrollmentId, score };
    });
    await teacher.put(`/api/v1/assess/assessments/${assessment.id}/grades`, { entries }, 200, { "idempotency-key": `seed-${data.slug}-grades-${a + 1}` });
    await teacher.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "SUBMITTED" });
    await pedago.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "REVIEWED" });
    await pedago.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "APPROVED" });
    await directeur.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "PUBLISHED" });
  }

  // ------------------------------------------------------------------------------------------------ bilan
  const statuses: string[] = [];
  for (const s of students) statuses.push(await statusOf(s.enrollmentId!));
  const mine = await learner.get("/api/v1/people/me/student");
  const family = await parent.raw("GET", "/api/v1/people/children");

  const notes: string[] = [...attendanceNotes];
  if (data.pack === "HIGHER") {
    notes.push("HIGHER : programme, curriculum UE/ECUE crédité, classe, inscriptions, factures, emploi du temps, appels, notes publiées. Les résultats de semestre (moteur de règles CI-HIGHER-LMD) se lancent depuis /v2/results.");
  } else {
    notes.push(`${data.pack} : la STRUCTURE disponible est créée (année, ${periodIds.length} périodes, programme, curriculum par matière, classe, personnes, inscriptions, factures, emploi du temps, appels, notes publiées).`);
    notes.push(`${data.pack} : pas de jeu de règles de calcul national pour ce pack dans cette version : aucun résultat, moyenne ni bulletin n'est généré (à configurer dans /v2/rules).`);
  }

  const counts = {
    students: students.length,
    guardians: guardianIds.length,
    teachers: teacherStaffIds.length,
    enrollments: students.length,
    enrollmentsActive: statuses.filter((s) => s === "ACTIVE").length,
    invoices: invoices.length,
    occurrences: occurrences.length,
    occurrencesGenerated: Number((generated.body.created ?? generated.body.createdCount) ?? 0),
    attendanceSessions: attendanceSessions.length,
    assessments: targets.length,
    grades: grades.length,
    periods: periodIds.length,
  };

  const fingerprint = createHash("sha256")
    .update(
      stable({
        pack: data.pack,
        year: data.yearCode,
        students: data.students.map((s, i) => ({ lastName: s.lastName, firstName: s.firstName, birthDate: s.birthDate, studentNumber: students[i]!.studentNumber, registrationNumber: students[i]!.registrationNumber, status: statuses[i] })),
        invoices,
        grades,
        statuses,
        ownChild: { number: (mine.body.studentNumber ?? mine.body.student?.studentNumber) as string | undefined, familyVisible: family.status === 200 },
        weekdays: teachable.map((_, i) => i + 1),
      }),
    )
    .digest("hex");

  return { alreadySeeded: false, slug: data.slug, pack: data.pack, tenantId, notes, counts, fingerprint, accounts: accounts.list() };
}
