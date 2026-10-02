/**
 * Intégration (Postgres réel ; s'ignore sans TEST_DATABASE_URL) :
 *  - événements `admissions.interview.scheduled|rescheduled|cancelled` (charges conformes aux contrats, sans donnée personnelle) ;
 *  - rattachement DIFFÉRÉ des pièces au dossier de l'élève (GED), confirmé par un humain : jamais par l'abonné système,
 *    idempotent, audité, isolé par tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsEventPayloadSchemas } from "@ecoledigitale/contracts/v2";
import { admissionsAttachToStudentFileResultDtoSchema } from "@ecoledigitale/contracts/src/v2/admissions";
import { reviewDocument, uploadDocument } from "../../application/documents";
import { handleEnrollmentConfirmed } from "../../application/enrollment-events";
import { createInterview, updateInterview } from "../../application/interviews";
import { acceptOffer, issueOffer } from "../../application/offers";
import { upsertRequirement } from "../../application/reference";
import { attachDocumentsToStudentFile } from "../../application/student-file";
import { describeIntegration } from "../support/db";
import { acceptApplication, createWorld, openCampaignWith, submittedApplication, unwrap, uuid, type TenantWorld, type World } from "../support/world";

const PDF = new TextEncoder().encode("%PDF-1.4 piece du dossier\n%%EOF");
const CATEGORY = uuid(0x9001);
const CAPS = { upload: true, read: true, readRestricted: true };

describeIntegration("admissions : événements d'entretien et rattachement différé à la GED", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  const events = async (t: TenantWorld, like: string) =>
    (await w.db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE $2 ORDER BY occurred_at, id", [t.id, like])).rows as Array<{ type: string; payload: Record<string, unknown> }>;

  describe("événements d'entretien", () => {
    it("planifier, reporter, annuler : un événement chacun, charges conformes aux contrats et sans donnée personnelle", async () => {
      const t = await w.tenant("entretien-events");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id);
      const first = new Date(Date.now() + 86_400_000).toISOString();
      const rooms = unwrap(await createInterview(t.deps, t.ctx(), app.id, { kind: "INTERVIEW", scheduledAt: first, venue: "Bureau du directeur" }));
      const id = rooms[0]!.id;

      const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
      unwrap(await updateInterview(t.deps, t.ctx(), app.id, id, { scheduledAt: later }));
      // Même instant redonné, lieu changé, note : rien à publier.
      unwrap(await updateInterview(t.deps, t.ctx(), app.id, id, { scheduledAt: later, venue: "Salle 3", notes: "RAS" }));
      unwrap(await updateInterview(t.deps, t.ctx(), app.id, id, { status: "CANCELLED" }));
      // Déjà annulé : une seconde annulation ne republie pas.
      unwrap(await updateInterview(t.deps, t.ctx(), app.id, id, { status: "CANCELLED", notes: "confirmé annulé" }));

      const published = await events(t, "admissions.interview.%");
      expect(published.map((e) => e.type)).toEqual(["admissions.interview.scheduled", "admissions.interview.rescheduled", "admissions.interview.cancelled"]);
      for (const e of published) {
        const schema = admissionsEventPayloadSchemas[e.type as keyof typeof admissionsEventPayloadSchemas];
        expect(schema.safeParse(e.payload).success, e.type).toBe(true);
        expect(e.payload).toMatchObject({ v: 1, applicationId: app.id, interviewId: id, kind: "INTERVIEW" });
      }
      expect(published[0]!.payload["scheduledAt"]).toBe(first);
      expect(published[1]!.payload).toMatchObject({ scheduledAt: later, previousScheduledAt: first });
      const blob = JSON.stringify(published);
      expect(blob).not.toMatch(/Bureau|Salle|RAS|annulé/);
    });

    it("saisie d'un résultat : aucun événement ; ré-planification après annulation : `scheduled`", async () => {
      const t = await w.tenant("entretien-resultat");
      const campaign = await openCampaignWith(t, { seats: { CP1: 5 } });
      const app = await submittedApplication(t, campaign.id);
      const rooms = unwrap(await createInterview(t.deps, t.ctx(), app.id, { kind: "TEST", scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
      const id = rooms[0]!.id;
      unwrap(await updateInterview(t.deps, t.ctx(), app.id, id, { status: "DONE", resultCode: "NOT_APPLICABLE" }));
      expect((await events(t, "admissions.interview.%")).map((e) => e.type)).toEqual(["admissions.interview.scheduled"]);

      const t2 = await w.tenant("entretien-replan");
      const c2 = await openCampaignWith(t2, { seats: { CP1: 5 } });
      const a2 = await submittedApplication(t2, c2.id);
      const r2 = unwrap(await createInterview(t2.deps, t2.ctx(), a2.id, { kind: "INTERVIEW", scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
      unwrap(await updateInterview(t2.deps, t2.ctx(), a2.id, r2[0]!.id, { status: "CANCELLED" }));
      unwrap(await updateInterview(t2.deps, t2.ctx(), a2.id, r2[0]!.id, { status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }));
      expect((await events(t2, "admissions.interview.%")).map((e) => e.type)).toEqual(["admissions.interview.scheduled", "admissions.interview.cancelled", "admissions.interview.scheduled"]);
    });

    it("RLS A/B : les événements d'un tenant ne sont pas visibles par l'autre", async () => {
      const a = await w.tenant("entretien-a");
      const b = await w.tenant("entretien-b");
      const ca = await openCampaignWith(a, { seats: { CP1: 5 } });
      const app = await submittedApplication(a, ca.id);
      unwrap(await createInterview(a.deps, a.ctx(), app.id, { kind: "TEST", scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
      expect(await events(b, "admissions.interview.%")).toHaveLength(0);
      const refused = await updateInterview(b.deps, b.ctx(), app.id, "0192f0a4-7b1e-7c3a-8d2e-00000000fffe", { status: "CANCELLED" });
      expect(refused.ok).toBe(false);
    });
  });

  describe("rattachement différé des pièces à la GED", () => {
    async function enrolled(slug: string) {
      const t = await w.tenant(slug);
      const campaign = await openCampaignWith(t, { seats: { CP1: 3 } });
      const req = unwrap(await upsertRequirement(t.deps, t.ctx(), { institutionId: t.institutionId, code: "ACTE_NAISSANCE", label: "Acte de naissance", required: false, acceptsMime: ["application/pdf"], maxSizeKb: 100 }));
      const app = await submittedApplication(t, campaign.id);
      unwrap(await uploadDocument(t.deps, t.ctx(), { applicationId: app.id, requirementId: req.id, fileName: "acte.pdf", bytes: PDF, by: "STAFF" }));
      unwrap(await reviewDocument(t.deps, t.ctx(), app.id, req.id, { decision: "ACCEPT" }));
      await acceptApplication(t, app.id);
      unwrap(await issueOffer(t.deps, t.ctx(), app.id, { classroomId: t.rooms.cp1 }));
      const offer = (await w.db.admin.query("SELECT id FROM admissions.offers WHERE application_id = $1", [app.id])).rows[0].id as string;
      const accepted = unwrap(await acceptOffer(t.deps, t.ctx(), { offerId: offer, via: "GUARDIAN_LINK" }));
      return { t, app, req, accepted };
    }

    it("l'abonné système ne rattache rien (pas de déposant humain) mais laisse la trace des pièces en attente", async () => {
      const { t, app, accepted } = await enrolled("ged-systeme");
      // Comme l'adaptateur de la plateforme : `link` ne sait que « non rattaché ».
      const platformLike = { ...t.deps, ports: { ...t.deps.ports, documents: { ...t.deps.ports.documents, link: async () => ({ linked: false }) } } } as typeof t.deps;
      const done = unwrap(await handleEnrollmentConfirmed(platformLike, t.systemCtx(), { enrollmentId: accepted.enrollmentId, studentId: accepted.studentId }));
      expect(done.documentsLinked).toBe(0);
      expect(w.audit.entries.some((e) => e.entry.action === "admissions.document.attach_pending" && e.entry.resourceId === app.id)).toBe(true);
      expect(t.mem.attachedBy).toHaveLength(0);
      const refs = await w.db.admin.query("SELECT document_ref FROM admissions.application_documents WHERE application_id = $1", [app.id]);
      expect(refs.rows.every((r) => r.document_ref === null)).toBe(true);
    });

    it("refusé tant que le dossier n'est pas inscrit, et sans utilisateur identifié", async () => {
      const { t, app } = await enrolled("ged-refus");
      const early = await attachDocumentsToStudentFile(t.deps, t.ctx(), app.id, { categoryId: CATEGORY, caps: CAPS });
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.error.code).toBe("admissions.invalid_input");
      const anon = await attachDocumentsToStudentFile(t.deps, t.systemCtx(), app.id, { categoryId: CATEGORY, caps: CAPS });
      expect(anon.ok).toBe(false);
      if (!anon.ok) expect(anon.error.code).toBe("admissions.forbidden");
    });

    it("un humain rattache : déposant = cette personne, document_ref posé, rejouable sans doublon, audité", async () => {
      const { t, app, accepted } = await enrolled("ged-humain");
      unwrap(await handleEnrollmentConfirmed(t.deps, t.systemCtx(), { enrollmentId: accepted.enrollmentId, studentId: accepted.studentId }));
      const first = unwrap(await attachDocumentsToStudentFile(t.deps, t.ctx(), app.id, { categoryId: CATEGORY, caps: CAPS }));
      expect(admissionsAttachToStudentFileResultDtoSchema.safeParse(first).success).toBe(true);
      expect(first).toMatchObject({ attached: 1, failed: 0 });
      expect(first.items[0]).toMatchObject({ outcome: "ATTACHED", code: null });
      expect(t.mem.attachedBy).toHaveLength(1);
      expect(t.mem.attachedBy[0]).toMatchObject({ studentId: accepted.studentId });
      expect(t.mem.attachedBy[0]!.userId).toBeTruthy();
      const refs = await w.db.admin.query("SELECT document_ref FROM admissions.application_documents WHERE application_id = $1 AND status = 'ACCEPTED'", [app.id]);
      expect(refs.rows[0].document_ref).toBe(first.items[0]!.documentRef);

      const again = unwrap(await attachDocumentsToStudentFile(t.deps, t.ctx(), app.id, { categoryId: CATEGORY, caps: CAPS }));
      expect(again).toMatchObject({ attached: 0, failed: 0, items: [] });
      expect(t.mem.attachedBy).toHaveLength(1);
      expect(w.audit.entries.some((e) => e.entry.action === "admissions.document.attach_to_student_file")).toBe(true);
    });

    it("port non branché : échec fermé `admissions.port_unavailable`, rien de modifié", async () => {
      const { t, app, accepted } = await enrolled("ged-sans-port");
      unwrap(await handleEnrollmentConfirmed(t.deps, t.systemCtx(), { enrollmentId: accepted.enrollmentId, studentId: accepted.studentId }));
      const bare = { ...t.deps, ports: { ...t.deps.ports, documents: { ...t.deps.ports.documents, attachToStudentFile: undefined } } } as typeof t.deps;
      const r = await attachDocumentsToStudentFile(bare, t.ctx(), app.id, { categoryId: CATEGORY, caps: CAPS });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("admissions.port_unavailable");
    });

    it("RLS A/B : un autre tenant ne peut pas rattacher les pièces de ce dossier", async () => {
      const { t, app, accepted } = await enrolled("ged-rls-a");
      unwrap(await handleEnrollmentConfirmed(t.deps, t.systemCtx(), { enrollmentId: accepted.enrollmentId, studentId: accepted.studentId }));
      const other = await w.tenant("ged-rls-b");
      const r = await attachDocumentsToStudentFile(other.deps, other.ctx(), app.id, { categoryId: CATEGORY, caps: CAPS });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("admissions.application_not_found");
    });
  });
});
