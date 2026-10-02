/**
 * Parcours du PACK PRIMARY, de bout en bout, sur une classe de maternelle (« Grande Section A ») qui s'ajoute à la classe de CP1
 * du scénario de base :
 *
 *   admission -> inscription (frais payés) -> appel JOURNALIER -> compétences (sans note) -> résultats (compteurs de compétences)
 *   -> conseil des maîtres (décisions HUMAINES) -> bilan annuel SCELLÉ (PDF signé).
 *
 * Tous les jeux de règles sont des PLACEHOLDERS (`CI-PRIMARY-PLACEHOLDER`) : aucune règle ivoirienne n'est inventée ; les documents
 * dérivés portent la mention « règles de démonstration ». Les périodes sont closes de façon accélérée pour la démonstration.
 */
import type { Actor } from "../actors";
import { applicantsFor, admitUntilPending, seedAdmissions } from "./admissions";
import { at, isoDay, today, waitFor, type DemoKit } from "./kit";

export interface Maternelle {
  classroomId: string;
  teacher: Actor;
  staffId: string;
  pupils: Array<{ studentId: string; enrollmentId: string; applicationId: string; name: string }>;
}

async function createMaternelleClass(kit: DemoKit): Promise<{ classroomId: string; teacher: Actor; staffId: string }> {
  const { ctx } = kit;
  const owner = ctx.owner;
  const levels = (await owner.get("/api/v1/academic/reference/grade-levels")).body.items as Array<{ id: string; code: string }>;
  const gs = levels.find((g) => g.code === "GS");
  if (!gs) throw new Error("Niveau GS absent du modèle de pack.");
  const programs = (await owner.get(`/api/v1/academic/programs?institutionId=${ctx.institutionId}`)).body.items as Array<{ id: string; code: string }>;
  const programId = programs.find((p) => p.code === "MATERNELLE")?.id;
  if (!programId) throw new Error("Programme MATERNELLE absent du modèle de pack.");
  const version = (await owner.post("/api/v1/academic/curriculum-versions", { programId, academicYearId: ctx.yearId }, 201)).body;
  const node = async (body: Record<string, unknown>): Promise<any> => (await owner.post(`/api/v1/academic/curriculum-versions/${version.id}/nodes`, body, 201)).body;
  const level = await node({ nodeTypeCode: "LEVEL", code: "GS", label: "Grande Section", gradeLevelId: gs.id });
  await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
  await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S2", label: "Semestre 2", periodTypeCode: "SEMESTER", periodOrdinal: 2 });
  await owner.post(`/api/v1/academic/curriculum-versions/${version.id}/publish`);
  const classroom = (
    await owner.post(
      "/api/v1/academic/classrooms",
      { institutionId: ctx.institutionId, academicYearId: ctx.yearId, programId, gradeLevelId: gs.id, curriculumVersionId: version.id, code: "GS-A", name: "Grande Section A", capacity: 25 },
      201,
    )
  ).body;

  // Instituteur titulaire de la maternelle (compte de portail) : la classe ne s'active qu'avec un titulaire.
  const cats = (await owner.get("/api/v1/people/reference/staff-categories")).body.items as Array<{ code: string; canTeach: boolean }>;
  const cat = cats.find((c) => c.canTeach);
  if (!cat) throw new Error("Aucune catégorie de personnel enseignant.");
  const email = `instituteur.maternelle@${ctx.data.slug}.test`;
  const staff = await owner.post("/api/v1/people/staff", { person: { lastName: "ZOKORA", firstName: "Sylvie", sex: "F", birthDate: "1987-06-09", email }, categoryCode: cat.code, hiredOn: "2021-09-01" }, 201);
  const staffId = (staff.body.staff?.id ?? staff.body.id) as string;
  await owner.post(`/api/v1/people/staff/${staffId}/portal-invitation`, { role: "instituteur" }, [200, 201]);
  const teacher = await ctx.accounts.portal("instituteur_maternelle", email);
  await owner.post("/api/v1/people/teaching-assignments", { staffId, academicYearId: ctx.yearId, classroomId: classroom.id, roleCode: "HOMEROOM", coversAllSubjects: true, startsOn: ctx.data.yearStart }, [200, 201]);
  await owner.post(`/api/v1/academic/classrooms/${classroom.id}/activate`, {});
  return { classroomId: classroom.id as string, teacher, staffId };
}

export async function seedMaternelle(kit: DemoKit, input: { officer: Actor }): Promise<Maternelle> {
  const { ctx } = kit;
  const { owner, directeur } = ctx;
  const cls = await createMaternelleClass(kit);

  // --- admission -> inscription : 5 enfants inscrits (frais payés) + les autres statuts de candidature --------------------
  const adm = await seedAdmissions(kit, { officer: input.officer, grade: "GS", classroomId: cls.classroomId, registrationFee: ctx.data.registrationFee, birthYear: 2021, campaignCode: "RENTREE-MATERNELLE", enrolledCount: 5 });
  const pupils = adm.enrolled.map((e, i) => ({ studentId: e.studentId, enrollmentId: e.enrollmentId, applicationId: e.applicationId, name: `${at(applicantsFor(ctx.data.slug, 2021, 14), i, "enfant").lastName}` }));

  // --- appel JOURNALIER par l'instituteur titulaire, validé par la direction -------------------------------------------------
  const opened = await cls.teacher.post("/api/v1/attendance/sessions", { scope: "DAILY", classroomId: cls.classroomId, date: isoDay(new Date()) }, [200, 201]);
  const sessionId = opened.body.session.id as string;
  await cls.teacher.put(`/api/v1/attendance/sessions/${sessionId}/records`, {
    entries: pupils.map((p, i) => ({ studentId: p.studentId, statusCode: i === 1 ? "ABSENT" : i === 2 ? "LATE" : "PRESENT", ...(i === 2 ? { minutesLate: 10 } : {}) })),
  });
  await cls.teacher.post(`/api/v1/attendance/sessions/${sessionId}/submit`, {});
  await directeur.post(`/api/v1/attendance/sessions/${sessionId}/validate`, {});
  kit.count("dailyAttendance", 1);

  // --- compétences (maternelle, SANS note) ----------------------------------------------------------------------------------
  const periodIds = ctx.periodIds;
  const sheet = await cls.teacher.get(`/api/v1/primary_school/classrooms/${cls.classroomId}/competency-sheet?periodId=${periodIds[0]}`);
  const frameworkId = sheet.body.framework.id as string;
  const competencyIds = (sheet.body.framework.domains as Array<{ competencies: Array<{ id: string }> }>).flatMap((d) => d.competencies.map((c) => c.id));
  const levels = Object.fromEntries((sheet.body.framework.scale.levels as Array<{ code: string; id: string }>).map((l) => [l.code, l.id])) as Record<string, string>;
  const linesFor = (): Array<{ enrollmentId: string; competencyId: string; ratingLevelId: string }> =>
    pupils.flatMap((p, i) =>
      competencyIds
        // l'élève 5 n'est pas évalué sur la dernière compétence : « non évaluée » reste non évaluée, jamais zéro
        .filter((_, c) => !(i === 4 && c === 2))
        .map((competencyId, c) => ({ enrollmentId: p.enrollmentId, competencyId, ratingLevelId: at([levels.N4, levels.N3, levels.N2, levels.N3, levels.N2], (i + c) % 5, "niveau") as string })),
    );
  await cls.teacher.put("/api/v1/primary_school/competency-assessments/bulk", { classroomId: cls.classroomId, periodId: periodIds[0], frameworkId, lines: linesFor() });
  await directeur.post(`/api/v1/primary_school/classrooms/${cls.classroomId}/periods/${periodIds[0]}/competencies/validate`, { frameworkId });
  kit.count("competencyLines", linesFor().length);

  // --- résultats : période 1 close ; dernière période : propositions à partir des compteurs de compétences --------------------
  await owner.put("/api/v1/results/settings", { requireDeliberation: false });
  const state = (idx: number): string => `/api/v1/results/classrooms/${cls.classroomId}/periods/${periodIds[idx]}`;
  await directeur.post(`${state(0)}/lock`, {});
  await directeur.post(`${state(0)}/close`, {});
  const last = periodIds.length - 1;
  await owner.post(`/api/v1/academic/periods/${periodIds[last]}/open`, {}, [200, 201, 409]);
  await cls.teacher.put("/api/v1/primary_school/competency-assessments/bulk", { classroomId: cls.classroomId, periodId: periodIds[last], frameworkId, lines: linesFor() });
  await directeur.post(`/api/v1/primary_school/classrooms/${cls.classroomId}/periods/${periodIds[last]}/competencies/validate`, { frameworkId });
  const locked = await directeur.post(`${state(last)}/lock`, {});

  // --- conseil des maîtres : dossiers, présence, décisions HUMAINES, procès-verbal -------------------------------------------
  const cats = (await owner.get("/api/v1/people/reference/staff-categories")).body.items as Array<{ code: string }>;
  const category = at(cats, 0, "catégorie").code;
  const councilStaff: Record<string, string> = {};
  for (const [key, last2, mail] of [["chair", "DIRECTEUR", "directeur.conseil"], ["secretary", "SECRETAIRE", "secretaire.conseil"]] as const) {
    const s = await owner.post("/api/v1/people/staff", { person: { lastName: last2, firstName: "Conseil", sex: "F", birthDate: "1980-01-01", email: `${mail}@${ctx.data.slug}.test` }, categoryCode: category, hiredOn: "2019-09-01" }, 201);
    councilStaff[key] = (s.body.staff?.id ?? s.body.id) as string;
  }
  await owner.put("/api/v1/reportcards/branding", { legalName: ctx.data.tenantName.replace(" (démonstration)", ""), headerLeft: ["République de Côte d'Ivoire (démonstration)"], address: "Abidjan", primaryColor: "#14532D" });
  const prep = await cls.teacher.post("/api/v1/primary_school/councils/prepare", { classroomId: cls.classroomId, periodId: periodIds[last], heldOn: today() }, [200, 201]);
  const deliberationId = prep.body.deliberationId as string;
  const cases = prep.body.cases as Array<{ id: string; enrollmentId: string }>;
  await directeur.put(`/api/v1/primary_school/councils/${deliberationId}/attendance`, {
    participants: [
      { staffId: cls.staffId, roleCode: "HOMEROOM", convened: true, present: true },
      { staffId: councilStaff.chair, roleCode: "CHAIR", convened: true, present: true },
      { staffId: councilStaff.secretary, roleCode: "SECRETARY", convened: true, present: true },
    ],
    signedStaffIds: [cls.staffId],
  });
  // décisions pour 3 enfants sur 5 : les deux autres restent à traiter (un testeur décide)
  const decisions: Array<[number, "PROMOTED" | "REPEAT", string]> = [
    [0, "PROMOTED", "Compétences acquises sur l'ensemble de l'année (décision de démonstration)."],
    [1, "PROMOTED", "Progrès constants relevés par l'équipe (décision de démonstration)."],
    [4, "REPEAT", "Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration)."],
  ];
  for (const [i, finalCode, justification] of decisions) {
    const c = cases.find((x) => x.enrollmentId === at(pupils, i, "élève").enrollmentId);
    if (!c) throw new Error("Dossier du conseil introuvable.");
    await directeur.post(`/api/v1/primary_school/councils/${deliberationId}/cases/${c.id}/decide`, { finalCode, justification });
  }
  kit.count("councilCasesDecided", decisions.length);
  void locked;

  // --- bilans annuels : préparés pour tous, SCELLÉS pour les enfants dont le conseil a décidé -------------------------------
  // (le scellement exige des périodes closes et un résultat d'année FINAL ; ici, seul le conseil complet le permet : on le tient pour tous)
  for (const c of cases) {
    if (decisions.some(([i]) => at(pupils, i, "élève").enrollmentId === c.enrollmentId)) continue;
    await directeur.post(`/api/v1/primary_school/councils/${deliberationId}/cases/${c.id}/decide`, { finalCode: "PROMOTED", justification: "Décision de démonstration prise en séance pour clore le conseil." });
  }
  await directeur.post(`/api/v1/primary_school/councils/${deliberationId}/minutes`, { heldOn: today() }, 201);
  await waitFor(async () => (await directeur.get(`/api/v1/primary_school/councils/${deliberationId}`)).body.minutesDocumentId, { label: "procès-verbal du conseil émis", timeoutMs: 120_000 });
  await directeur.patch(`/api/v1/results/deliberations/${deliberationId}`, { status: "HELD", heldOn: today() });
  await directeur.post(`${state(last)}/close`, {});
  for (const periodId of periodIds) {
    const base = `/api/v1/academic/classrooms/${cls.classroomId}/periods/${periodId}`;
    await directeur.post(`${base}/close-grading`, {}, [200, 201, 409]);
    await directeur.post(`${base}/close`, {}, [200, 201]);
  }
  const reviews = await directeur.post("/api/v1/primary_school/annual-reviews/prepare", { classroomId: cls.classroomId, academicYearId: ctx.yearId }, [200, 201]);
  const items = reviews.body.reviews as Array<{ id: string; enrollmentId: string; status: string }>;
  let sealed = 0;
  for (const r of items.slice(0, 3)) {
    await directeur.post(`/api/v1/primary_school/annual-reviews/${r.id}/seal`, {});
    sealed += 1;
  }
  for (const r of items.slice(0, 3)) {
    await waitFor(async () => (await directeur.get(`/api/v1/primary_school/annual-reviews/${r.id}`)).body.reportcardId, { label: "PDF du bilan annuel", timeoutMs: 120_000 });
  }
  kit.count("annualReviews", items.length);
  kit.count("annualReviewsSealed", sealed);
  kit.note(`Primaire (maternelle GS-A) : 5 inscrits, appel journalier, compétences, résultats par compteurs, conseil des maîtres tenu, ${items.length} bilans préparés dont ${sealed} SCELLÉS (PDF avec filigrane « démonstration ») ; les autres sont prêts à sceller.`);
  return { classroomId: cls.classroomId, teacher: cls.teacher, staffId: cls.staffId, pupils };
}
