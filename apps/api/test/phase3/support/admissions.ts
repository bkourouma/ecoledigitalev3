/**
 * Gestes d'admission partagés par les deux parcours de bout en bout de la phase 3 : TOUT passe par HTTP (rôles réels, jetons IAM).
 *
 *   consentement versionné -> campagne ouverte (capacités) -> candidature -> consentement du tuteur -> étude -> décision d'admission
 *   -> offre -> acceptation (saga : élève INACTIF, inscription PENDING, facture des frais d'inscription) -> paiement -> ENROLLED dérivé.
 */
import { expect } from "vitest";
import type { Actor } from "../../phase2/support/actors";

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export interface Campaign {
  id: string;
  workflowId: string;
  stages: Record<string, string>;
}

/** Texte de consentement publié, campagne créée sur le workflow PUBLIÉ de l'établissement, capacités, ouverture. */
export async function openCampaign(own: Actor, input: { institutionId: string; academicYearId: string; code: string; grade: string; seats: number; programId?: string }): Promise<Campaign> {
  await own.post("/api/v1/admissions/consent-texts", { institutionId: input.institutionId, kind: "DATA_PROCESSING", version: "v1", language: "fr", body: "Texte de consentement de démonstration pour le traitement des données du dossier de candidature." }, [200, 201]);
  const wfs = await own.get(`/api/v1/admissions/workflows?institutionId=${input.institutionId}`);
  const published = (wfs.body.items as Array<{ id: string; status: string }>).find((w) => w.status === "PUBLISHED");
  expect(published, JSON.stringify(wfs.body)).toBeDefined();
  const wf = await own.get(`/api/v1/admissions/workflows/${published!.id}`);
  const stages: Record<string, string> = {};
  for (const s of wf.body.stages as Array<{ id: string; code: string }>) stages[s.code] = s.id;
  const now = Date.now();
  const campaign = await own.post("/api/v1/admissions/campaigns", {
    institutionId: input.institutionId,
    academicYearId: input.academicYearId,
    code: input.code,
    label: `Campagne ${input.code}`,
    workflowId: published!.id,
    opensAt: new Date(now - 86_400_000).toISOString(),
    closesAt: new Date(now + 90 * 86_400_000).toISOString(),
  }, 201);
  await own.put(`/api/v1/admissions/campaigns/${campaign.body.id}/capacities`, { capacities: [{ gradeLevelCode: input.grade, ...(input.programId ? { programId: input.programId } : {}), seats: input.seats }] });
  await own.post(`/api/v1/admissions/campaigns/${campaign.body.id}/open`, {});
  return { id: campaign.body.id, workflowId: published!.id, stages };
}

export interface Admitted {
  applicationId: string;
  studentId: string;
  enrollmentId: string;
  invoiceId: string | null;
  guardianId: string;
  responseToken: string;
  offerId: string;
}

export interface ApplicantInput {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: "M" | "F";
  grade: string;
  guardianEmail: string;
  guardianPhone: string;
  guardianFirstName: string;
}

/** Jusqu'à l'inscription EN ATTENTE (frais d'inscription facturés si un barème existe). Le paiement n'est PAS fait ici. */
export async function admitUntilPending(own: Actor, campaign: Campaign, a: ApplicantInput, classroomId: string): Promise<Admitted> {
  const rel = await own.get("/api/v1/people/reference/relationship-types");
  const relationshipCode = (rel.body.items as Array<{ code: string }>)[0]?.code as string;
  expect(relationshipCode).toBeTruthy();
  const created = await own.post("/api/v1/admissions/applications", {
    campaignId: campaign.id,
    applicantFirstName: a.firstName,
    applicantLastName: a.lastName,
    applicantBirthDate: a.birthDate,
    applicantBirthPlace: "Abidjan",
    applicantGender: a.gender === "F" ? "FEMALE" : "MALE",
    desiredGradeLevelCode: a.grade,
    sourceChannel: "WALK_IN",
    guardians: [{ firstName: a.guardianFirstName, lastName: a.lastName, relationshipCode, email: a.guardianEmail, phone: a.guardianPhone, isPrimary: true, isFinancialResponsible: true }],
  }, 201);
  const applicationId = created.body.id as string;
  const detail0 = await own.get(`/api/v1/admissions/applications/${applicationId}`);
  const guardianId = detail0.body.guardians[0].id as string;
  await own.post(`/api/v1/admissions/applications/${applicationId}/consents`, { guardianId, kind: "DATA_PROCESSING", textVersion: "v1", givenVia: "STAFF_ON_BEHALF", evidenceRef: "formulaire papier signé" });

  const move = async (code: string): Promise<void> => {
    const d = await own.get(`/api/v1/admissions/applications/${applicationId}`);
    await own.post(`/api/v1/admissions/applications/${applicationId}/transition`, { toStageId: campaign.stages[code], rowVersion: d.body.rowVersion }, [200, 201]);
  };
  await move("SUBMITTED");
  await move("UNDER_REVIEW");
  const d = await own.get(`/api/v1/admissions/applications/${applicationId}`);
  await own.post(`/api/v1/admissions/applications/${applicationId}/decisions`, { toStageId: campaign.stages.ACCEPTED, kind: "ACCEPT", reasonCode: "ADMITTED", rowVersion: d.body.rowVersion }, [200, 201]);
  const offer = await own.post(`/api/v1/admissions/applications/${applicationId}/offers`, { classroomId, conditions: "Offre de démonstration." }, 201);
  const accepted = await own.post(`/api/v1/admissions/offers/${offer.body.offer.id}/accept-on-behalf`, { guardianId, evidenceRef: "accord oral du tuteur, consigné", classroomId }, [200, 201]);
  return {
    applicationId,
    studentId: accepted.body.studentId,
    enrollmentId: accepted.body.enrollmentId,
    invoiceId: accepted.body.invoiceId ?? null,
    guardianId,
    responseToken: offer.body.responseToken,
    offerId: offer.body.offer.id,
  };
}
