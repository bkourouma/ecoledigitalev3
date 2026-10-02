/**
 * Admissions : une campagne ouverte et des candidatures à tous les statuts utiles pour la démonstration :
 * ENROLLED, inscription EN ATTENTE de paiement, offre émise (ACCEPTED), EN ÉTUDE, REÇUE, PIÈCES MANQUANTES, LISTE D'ATTENTE,
 * REFUSÉE, BROUILLON. Tout passe par HTTP : campagne et paiement par le propriétaire, dossiers par le chargé d'admissions.
 *
 * Les notifications d'admission (candidature reçue, offre…) sont mises EN FILE par `notifications` : aucun envoi réel.
 */
import type { Actor } from "../actors";
import { addDays, at, waitFor, type DemoKit } from "./kit";

export interface Campaign {
  id: string;
  workflowId: string;
  stages: Record<string, string>;
}

export interface Applicant {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: "M" | "F";
  guardianFirstName: string;
  guardianEmail: string;
  guardianPhone: string;
}

export interface Admitted {
  applicationId: string;
  studentId: string;
  enrollmentId: string;
  invoiceId: string | null;
  guardianId: string;
  offerId: string;
  responseToken: string;
}

const NAMES: Array<[string, string, "M" | "F"]> = [
  ["Aïcha", "ADOU", "F"],
  ["Brice", "ASSI", "M"],
  ["Chantal", "DAGO", "F"],
  ["Désiré", "EKRA", "M"],
  ["Estelle", "FOFANA", "F"],
  ["Fabrice", "GUEI", "M"],
  ["Grâce", "HIEN", "F"],
  ["Hervé", "KRA", "M"],
  ["Inès", "LOBA", "F"],
  ["Jonas", "MEL", "M"],
  ["Karine", "NAMA", "F"],
  ["Lazare", "OKOU", "M"],
  ["Martine", "PEHE", "F"],
  ["Noël", "SERI", "M"],
  ["Odile", "TANOH", "F"],
  ["Pacôme", "UEHI", "M"],
];

export function applicantsFor(slug: string, birthYear: number, count: number, offset = 0): Applicant[] {
  return NAMES.slice(offset, offset + count).map(([firstName, lastName, gender], i) => ({
    firstName,
    lastName,
    birthDate: `${birthYear - (i % 2)}-${String(2 + ((i + offset) % 9)).padStart(2, "0")}-${String(5 + ((i + offset) % 20)).padStart(2, "0")}`,
    gender,
    guardianFirstName: gender === "F" ? "Parent" : "Tuteur",
    guardianEmail: `candidat${i + offset + 1}@${slug}.test`,
    guardianPhone: `+225 05 ${String(10 + i + offset).padStart(2, "0")} ${String(20 + i).padStart(2, "0")} ${String(30 + i).padStart(2, "0")} ${String(40 + offset).padStart(2, "0")}`,
  }));
}

/** Texte de consentement publié, campagne créée sur le workflow PUBLIÉ de l'établissement, capacités, ouverture. */
export async function openCampaign(own: Actor, input: { institutionId: string; academicYearId: string; code: string; grade: string; seats: number; programId?: string }): Promise<Campaign> {
  await own.post("/api/v1/admissions/consent-texts", { institutionId: input.institutionId, kind: "DATA_PROCESSING", version: "v1", language: "fr", body: "Texte de consentement de démonstration pour le traitement des données du dossier de candidature." }, [200, 201]);
  const wfs = await own.get(`/api/v1/admissions/workflows?institutionId=${input.institutionId}`);
  const published = (wfs.body.items as Array<{ id: string; status: string }>).find((w) => w.status === "PUBLISHED");
  if (!published) throw new Error("Aucun workflow d'admission publié.");
  const wf = await own.get(`/api/v1/admissions/workflows/${published.id}`);
  const stages: Record<string, string> = {};
  for (const s of wf.body.stages as Array<{ id: string; code: string }>) stages[s.code] = s.id;
  const now = Date.now();
  const campaign = await own.post(
    "/api/v1/admissions/campaigns",
    {
      institutionId: input.institutionId,
      academicYearId: input.academicYearId,
      code: input.code,
      label: `Campagne ${input.code}`,
      workflowId: published.id,
      opensAt: new Date(now - 86_400_000).toISOString(),
      closesAt: new Date(now + 90 * 86_400_000).toISOString(),
    },
    201,
  );
  await own.put(`/api/v1/admissions/campaigns/${campaign.body.id}/capacities`, { capacities: [{ gradeLevelCode: input.grade, ...(input.programId ? { programId: input.programId } : {}), seats: input.seats }] });
  await own.post(`/api/v1/admissions/campaigns/${campaign.body.id}/open`, {});
  return { id: campaign.body.id, workflowId: published.id, stages };
}

/** Crée la candidature, recueille le consentement du tuteur ; ne la fait pas avancer. */
export async function createApplication(officer: Actor, campaign: Campaign, grade: string, a: Applicant, relationshipCode: string): Promise<{ applicationId: string; guardianId: string }> {
  const created = await officer.post(
    "/api/v1/admissions/applications",
    {
      campaignId: campaign.id,
      applicantFirstName: a.firstName,
      applicantLastName: a.lastName,
      applicantBirthDate: a.birthDate,
      applicantBirthPlace: "Abidjan",
      applicantGender: a.gender === "F" ? "FEMALE" : "MALE",
      desiredGradeLevelCode: grade,
      sourceChannel: "WALK_IN",
      guardians: [{ firstName: a.guardianFirstName, lastName: a.lastName, relationshipCode, email: a.guardianEmail, phone: a.guardianPhone, isPrimary: true, isFinancialResponsible: true }],
    },
    201,
  );
  const applicationId = created.body.id as string;
  const detail = await officer.get(`/api/v1/admissions/applications/${applicationId}`);
  const guardianId = at(detail.body.guardians as Array<{ id: string }>, 0, "tuteur du dossier").id;
  await officer.post(`/api/v1/admissions/applications/${applicationId}/consents`, { guardianId, kind: "DATA_PROCESSING", textVersion: "v1", givenVia: "STAFF_ON_BEHALF", evidenceRef: "formulaire papier signé (démonstration)" });
  return { applicationId, guardianId };
}

export async function moveTo(officer: Actor, campaign: Campaign, applicationId: string, stageCode: string): Promise<void> {
  const d = await officer.get(`/api/v1/admissions/applications/${applicationId}`);
  await officer.post(`/api/v1/admissions/applications/${applicationId}/transition`, { toStageId: campaign.stages[stageCode], rowVersion: d.body.rowVersion }, [200, 201]);
}

export async function decide(officer: Actor, campaign: Campaign, applicationId: string, stageCode: string, kind: "ACCEPT" | "REJECT" | "WAITLIST", reasonCode: string): Promise<void> {
  const d = await officer.get(`/api/v1/admissions/applications/${applicationId}`);
  await officer.post(`/api/v1/admissions/applications/${applicationId}/decisions`, { toStageId: campaign.stages[stageCode], kind, reasonCode, rowVersion: d.body.rowVersion }, [200, 201]);
}

/** Jusqu'à l'inscription EN ATTENTE (frais d'inscription facturés s'il existe un barème). Le paiement n'est PAS fait ici. */
export async function admitUntilPending(officer: Actor, decider: Actor, campaign: Campaign, grade: string, a: Applicant, classroomId: string, relationshipCode: string): Promise<Admitted> {
  const { applicationId, guardianId } = await createApplication(officer, campaign, grade, a, relationshipCode);
  await moveTo(officer, campaign, applicationId, "SUBMITTED");
  await moveTo(officer, campaign, applicationId, "UNDER_REVIEW");
  await decide(decider, campaign, applicationId, "ACCEPTED", "ACCEPT", "ADMITTED");
  const offer = await officer.post(`/api/v1/admissions/applications/${applicationId}/offers`, { classroomId, conditions: "Offre de démonstration." }, 201);
  const accepted = await officer.post(`/api/v1/admissions/offers/${offer.body.offer.id}/accept-on-behalf`, { guardianId, evidenceRef: "accord oral du tuteur, consigné (démonstration)", classroomId }, [200, 201]);
  return {
    applicationId,
    studentId: accepted.body.studentId,
    enrollmentId: accepted.body.enrollmentId,
    invoiceId: accepted.body.invoiceId ?? null,
    guardianId,
    offerId: offer.body.offer.id,
    responseToken: offer.body.responseToken,
  };
}


export interface AdmissionsResult {
  campaign: Campaign;
  /** Candidatures menées jusqu'à ENROLLED (frais d'inscription payés). */
  enrolled: Admitted[];
  awaitingPayment: Admitted;
}

/**
 * Jeu de candidatures de la démonstration. `registrationFee` : montant du barème des frais d'inscription (paiement des candidats
 * inscrits). `officer` : le chargé d'admissions ; propriétaire : campagne et paiements.
 */
export async function seedAdmissions(
  kit: DemoKit,
  input: { officer: Actor; grade: string; classroomId: string; registrationFee: number; birthYear: number; campaignCode: string; programId?: string; enrolledCount?: number },
): Promise<AdmissionsResult> {
  const { ctx } = kit;
  const owner = ctx.owner;
  const enrolledCount = input.enrolledCount ?? 1;
  const apps = applicantsFor(ctx.data.slug, input.birthYear, enrolledCount + 8);
  const campaign = await openCampaign(owner, { institutionId: ctx.institutionId, academicYearId: ctx.yearId, code: input.campaignCode, grade: input.grade, seats: enrolledCount + 12, ...(input.programId ? { programId: input.programId } : {}) });
  // Le chargé d'admissions n'a pas accès aux référentiels des personnes : le code du lien de parenté est lu par le propriétaire.
  const relationshipCode = at((await owner.get("/api/v1/people/reference/relationship-types")).body.items as Array<{ code: string }>, 0, "type de lien").code;
  let cursor = 0;
  const next = (what: string): Applicant => at(apps, cursor++, what);

  // Candidats inscrits et payés : dossier ENROLLED (état dérivé de la confirmation d'inscription, jamais posé à la main).
  const enrolled: Admitted[] = [];
  for (let k = 0; k < enrolledCount; k += 1) {
    const adm = await admitUntilPending(input.officer, ctx.directeur, campaign, input.grade, next("candidat inscrit"), input.classroomId, relationshipCode);
    if (!adm.invoiceId) throw new Error("Aucune facture de frais d'inscription n'a été créée à l'acceptation de l'offre (barème d'inscription ?).");
    await owner.post(
      "/api/v1/finance/payments",
      { learnerId: adm.studentId, enrollmentId: adm.enrollmentId, amount: input.registrationFee, method: "TRANSFER", reference: `VIR-ADM-${ctx.data.slug}-${input.campaignCode}-${k + 1}`, allocation: { mode: "AUTO", invoiceIds: [adm.invoiceId] } },
      [200, 201],
      { "idempotency-key": `demo-adm-pay-${ctx.data.slug}-${input.campaignCode}-${k + 1}` },
    );
    enrolled.push(adm);
  }
  for (const adm of enrolled) {
    await waitFor(async () => (await input.officer.get(`/api/v1/admissions/applications/${adm.applicationId}`)).body.status === "ENROLLED", { label: "dossier ENROLLED", timeoutMs: 90_000 });
  }
  // Inscription en attente de paiement (facture émise, non réglée).
  const awaitingPayment = await admitUntilPending(input.officer, ctx.directeur, campaign, input.grade, next("candidat en attente de paiement"), input.classroomId, relationshipCode);
  // Admis, offre émise, réponse de la famille attendue.
  const offered = await createApplication(input.officer, campaign, input.grade, next("candidat avec offre"), relationshipCode);
  await moveTo(input.officer, campaign, offered.applicationId, "SUBMITTED");
  await moveTo(input.officer, campaign, offered.applicationId, "UNDER_REVIEW");
  await decide(ctx.directeur, campaign, offered.applicationId, "ACCEPTED", "ACCEPT", "ADMITTED");
  await input.officer.post(`/api/v1/admissions/applications/${offered.applicationId}/offers`, { classroomId: input.classroomId, conditions: "Offre de démonstration, réponse attendue." }, 201);
  // En étude.
  const review = await createApplication(input.officer, campaign, input.grade, next("candidat en étude"), relationshipCode);
  await moveTo(input.officer, campaign, review.applicationId, "SUBMITTED");
  await moveTo(input.officer, campaign, review.applicationId, "UNDER_REVIEW");
  // Candidature reçue.
  const received = await createApplication(input.officer, campaign, input.grade, next("candidat reçu"), relationshipCode);
  await moveTo(input.officer, campaign, received.applicationId, "SUBMITTED");
  // Pièces manquantes.
  const missing = await createApplication(input.officer, campaign, input.grade, next("candidat pièces manquantes"), relationshipCode);
  await moveTo(input.officer, campaign, missing.applicationId, "SUBMITTED");
  await moveTo(input.officer, campaign, missing.applicationId, "UNDER_REVIEW");
  await moveTo(input.officer, campaign, missing.applicationId, "MISSING_DOCUMENT");
  // Liste d'attente.
  const waiting = await createApplication(input.officer, campaign, input.grade, next("candidat en liste d'attente"), relationshipCode);
  await moveTo(input.officer, campaign, waiting.applicationId, "SUBMITTED");
  await moveTo(input.officer, campaign, waiting.applicationId, "UNDER_REVIEW");
  await decide(ctx.directeur, campaign, waiting.applicationId, "WAITLISTED", "WAITLIST", "NO_SEAT_YET");
  // Refusée.
  const rejected = await createApplication(input.officer, campaign, input.grade, next("candidat refusé"), relationshipCode);
  await moveTo(input.officer, campaign, rejected.applicationId, "SUBMITTED");
  await moveTo(input.officer, campaign, rejected.applicationId, "UNDER_REVIEW");
  await decide(ctx.directeur, campaign, rejected.applicationId, "REJECTED", "REJECT", "FILE_INCOMPLETE");
  // Brouillon.
  await createApplication(input.officer, campaign, input.grade, next("candidat brouillon"), relationshipCode);

  kit.count("applications", enrolledCount + 8);
  kit.note(`Admissions (${input.grade}) : ${enrolledCount + 8} candidatures (${enrolledCount} inscrites et payées, inscription en attente de paiement, offre émise, en étude, reçue, pièces manquantes, liste d'attente, refusée, brouillon) ; notifications mises en file, aucun envoi réel.`);
  return { campaign, enrolled, awaitingPayment };
}
