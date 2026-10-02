/**
 * Monde de test : deux tenants A et B sur une base RÉELLE (migrations 1900-1902, rôle applicatif soumis à la RLS), des ports en
 * mémoire cloisonnés par tenant (people, academic, finance, documents, notifications simulés), une horloge réglable. Les gardes de
 * permission sont testées en HTTP (`http.integration.test.ts`) ; ici les cas d'usage reçoivent directement un contexte.
 */
import { createRequestContext, type Clock, type RequestContext } from "@ecoledigitale/kernel";
import { SystemDb } from "@ecoledigitale/database";
import type { AdmissionsCampaignDto, AdmissionsApplicationDetailDto, AdmissionsCreateApplicationBody } from "@ecoledigitale/contracts/src/v2/admissions";
import { createApplication, getApplication, recordConsent, transitionApplication } from "../../application/applications";
import { closeCampaign as _close, createCampaign, openCampaign, upsertCapacities } from "../../application/campaigns";
import { recordDecision } from "../../application/decisions";
import { createAdmissionsDeps, type AdmissionsDeps } from "../../application/deps";
import { ensureInstitutionDefaults } from "../../application/defaults";
import { RecordingAudit } from "../../application/ports";
import { managePublicLink, publishConsentText, updateSettings } from "../../application/reference";
import { listWorkflows } from "../../application/workflows";
import { InMemoryWorld } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, type ModuleTestDb } from "./db";

void _close;

export const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

export const USERS = { director: uuid(0x101), secretary: uuid(0x102), other: uuid(0x103) } as const;
export const YEAR_ID = uuid(0x401);

export interface MutableClock extends Clock {
  set(d: Date): void;
  advanceDays(n: number): void;
  advanceSeconds(n: number): void;
}

export function mutableClock(start: Date = new Date()): MutableClock {
  let current = start;
  return {
    now: () => current,
    set: (d) => {
      current = d;
    },
    advanceDays: (n) => {
      current = new Date(current.getTime() + n * 86_400_000);
    },
    advanceSeconds: (n) => {
      current = new Date(current.getTime() + n * 1000);
    },
  };
}

export interface TenantWorld {
  readonly id: string;
  readonly slug: string;
  readonly mem: InMemoryWorld;
  readonly deps: AdmissionsDeps;
  readonly institutionId: string;
  readonly workflowId: string;
  readonly rooms: { cp1: string; cp2: string };
  ctx(userId?: string): RequestContext;
  systemCtx(): RequestContext;
}

export interface World {
  readonly db: ModuleTestDb;
  readonly clock: MutableClock;
  readonly audit: RecordingAudit;
  readonly A: TenantWorld;
  readonly B: TenantWorld;
  close(): Promise<void>;
  /** Un tenant supplémentaire (isolé), initialisé comme A et B. */
  tenant(slug: string): Promise<TenantWorld>;
}

async function setupTenant(db: ModuleTestDb, clock: MutableClock, audit: RecordingAudit, slug: string, offset: number): Promise<TenantWorld> {
  const id = await db.createTenant(slug);
  const mem = new InMemoryWorld();
  const institution = mem.addInstitution(`Établissement ${slug}`, uuid(0x500 + offset));
  const cp1 = mem.addClassroom({ institutionId: institution.id, academicYearId: YEAR_ID, gradeLevelCode: "CP1", label: "CP1 A", id: uuid(0x600 + offset) });
  const cp2 = mem.addClassroom({ institutionId: institution.id, academicYearId: YEAR_ID, gradeLevelCode: "CP2", label: "CP2 A", id: uuid(0x700 + offset) });
  const deps = createAdmissionsDeps({
    db: db.tenantDb,
    systemDb: new SystemDb(db.tenantDb),
    clock,
    audit,
    ports: mem.ports(),
    config: { fingerprintSecret: "secret-de-test-0123456789abcdef" },
  });
  const ctx = (userId: string = USERS.director): RequestContext => createRequestContext({ tenantId: id, userId });
  const systemCtx = (): RequestContext => createRequestContext({ tenantId: id, actor: "system", userId: null });
  const defaults = await ensureInstitutionDefaults(deps, ctx(), institution.id);
  if (!defaults.ok) throw defaults.error;
  return { id, slug, mem, deps, institutionId: institution.id, workflowId: defaults.value.workflowId, rooms: { cp1: cp1.id, cp2: cp2.id }, ctx, systemCtx };
}

export async function createWorld(): Promise<World> {
  const db = await createModuleTestDb();
  const clock = mutableClock();
  const audit = new RecordingAudit();
  const A = await setupTenant(db, clock, audit, "alpha", 1);
  const B = await setupTenant(db, clock, audit, "bravo", 2);
  let extra = 3;
  return {
    db,
    clock,
    audit,
    A,
    B,
    close: () => db.drop(),
    tenant: (slug) => setupTenant(db, clock, audit, slug, extra++),
  };
}

/** Texte de consentement publié et désigné, formulaire public ouvert, lien créé : retourne le slug public. */
export async function openPublicForm(t: TenantWorld, options: { minimumFormSeconds?: number; submissionsPer10Min?: number } = {}): Promise<string> {
  const text = await publishConsentText(t.deps, t.ctx(), { institutionId: t.institutionId, kind: "DATA_PROCESSING", version: "v1", language: "fr", body: "Je consens au traitement des données de mon enfant pour l'étude de sa candidature." }, { designate: true });
  if (!text.ok && text.error.code !== "admissions.reference_code_taken") throw text.error;
  const s = await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, publicFormEnabled: true, minimumFormSeconds: options.minimumFormSeconds ?? 0, ...(options.submissionsPer10Min ? { submissionsPer10Min: options.submissionsPer10Min } : {}) });
  if (!s.ok) throw s.error;
  const link = await managePublicLink(t.deps, t.ctx(), { institutionId: t.institutionId, enabled: true });
  if (!link.ok) throw link.error;
  return link.value.publicFormSlug as string;
}

/** Texte de consentement v1 (nécessaire aux consentements enregistrés par le personnel). */
export async function ensureConsentText(t: TenantWorld): Promise<void> {
  const r = await publishConsentText(t.deps, t.ctx(), { institutionId: t.institutionId, kind: "DATA_PROCESSING", version: "v1", language: "fr", body: "Je consens au traitement des données de mon enfant pour l'étude de sa candidature." }, { designate: true });
  if (!r.ok && r.error.code !== "admissions.reference_code_taken") throw r.error;
}

export interface CampaignOptions {
  seats?: Record<string, number>;
  waitlistLimit?: number;
  code?: string;
}

/** Campagne OUVERTE (workflow modèle publié) avec ses capacités par niveau. */
export async function openCampaignWith(t: TenantWorld, options: CampaignOptions = {}): Promise<AdmissionsCampaignDto> {
  const opensAt = new Date(Date.now() - 86_400_000).toISOString();
  const closesAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const created = await createCampaign(t.deps, t.ctx(), { institutionId: t.institutionId, academicYearId: YEAR_ID, code: options.code ?? `C-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, label: "Rentrée de test", workflowId: t.workflowId, opensAt, closesAt });
  if (!created.ok) throw created.error;
  if (options.seats) {
    const cap = await upsertCapacities(t.deps, t.ctx(), created.value.id, {
      capacities: Object.entries(options.seats).map(([gradeLevelCode, seats]) => ({ gradeLevelCode, seats, ...(options.waitlistLimit !== undefined ? { waitlistLimit: options.waitlistLimit } : {}) })),
    });
    if (!cap.ok) throw cap.error;
  }
  const opened = await openCampaign(t.deps, t.ctx(), created.value.id);
  if (!opened.ok) throw opened.error;
  return opened.value;
}

let counter = 0;

export function applicationBody(campaignId: string, overrides: Partial<AdmissionsCreateApplicationBody> = {}): AdmissionsCreateApplicationBody {
  counter += 1;
  return {
    campaignId,
    applicantFirstName: `Awa${counter}`,
    applicantLastName: "Konaté",
    applicantBirthDate: "2019-04-12",
    applicantGender: "FEMALE",
    isRepeating: false,
    desiredGradeLevelCode: "CP1",
    fundingTypeRequested: "PRIVATE",
    sourceChannel: "WALK_IN",
    guardians: [{ relationshipCode: "MOTHER", firstName: "Mariam", lastName: "Konaté", phone: "+22507000000", email: `mariam${counter}@example.test`, isPrimary: true, isFinancialResponsible: true, canConsent: true }],
    extra: {},
    ...overrides,
  };
}

export async function stage(t: TenantWorld, workflowId: string, code: string): Promise<string> {
  const wfs = await listWorkflows(t.deps, t.ctx(), t.institutionId);
  if (!wfs.ok) throw wfs.error;
  void wfs;
  const { getWorkflowDetail } = await import("../../application/workflows");
  const d = await getWorkflowDetail(t.deps, t.ctx(), workflowId);
  if (!d.ok) throw d.error;
  const s = d.value.stages.find((x) => x.code === code);
  if (!s) throw new Error(`étape ${code} introuvable`);
  return s.id;
}

/** Crée une candidature (personnel) et la soumet : consentement papier, DRAFT -> SUBMITTED. */
export async function submittedApplication(t: TenantWorld, campaignId: string, overrides: Partial<AdmissionsCreateApplicationBody> = {}): Promise<AdmissionsApplicationDetailDto> {
  await ensureConsentText(t);
  const created = await createApplication(t.deps, t.ctx(), applicationBody(campaignId, overrides));
  if (!created.ok) throw created.error;
  const detail = await getApplication(t.deps, t.ctx(), created.value.id);
  if (!detail.ok) throw detail.error;
  const guardian = detail.value.guardians[0]!;
  const consent = await recordConsent(t.deps, t.ctx(), created.value.id, { guardianId: guardian.id, kind: "DATA_PROCESSING", textVersion: "v1", givenVia: "PAPER", evidenceRef: "formulaire-papier-2026-001" });
  if (!consent.ok) throw consent.error;
  const toSubmitted = consent.value.allowedTransitions.find((x) => x.toStageCode === "SUBMITTED")!;
  const submitted = await transitionApplication(t.deps, t.ctx(), created.value.id, { toStageId: toSubmitted.toStageId });
  if (!submitted.ok) throw submitted.error;
  return submitted.value;
}

/** Fait avancer un dossier : étude puis décision d'admission (ACCEPT). */
export async function acceptApplication(t: TenantWorld, applicationId: string): Promise<AdmissionsApplicationDetailDto> {
  let detail = unwrap(await getApplication(t.deps, t.ctx(), applicationId));
  if (detail.stageCode === "SUBMITTED") {
    const review = detail.allowedTransitions.find((x) => x.toStageCode === "UNDER_REVIEW")!;
    detail = unwrap(await transitionApplication(t.deps, t.ctx(), applicationId, { toStageId: review.toStageId }));
  }
  const accept = detail.allowedTransitions.find((x) => x.toStageCode === "ACCEPTED")!;
  return unwrap(await recordDecision(t.deps, t.ctx(), applicationId, { toStageId: accept.toStageId, kind: "ACCEPT", overrideCapacity: false }));
}

export function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw Object.assign(new Error(`${r.error.code}: ${r.error.message}`), { code: r.error.code });
  return r.value;
}
