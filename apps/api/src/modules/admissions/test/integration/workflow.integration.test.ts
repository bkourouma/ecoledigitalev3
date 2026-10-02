/**
 * Intégration (Postgres réel, rôle applicatif soumis à la RLS ; s'ignore sans TEST_DATABASE_URL) : workflow personnalisable
 * (modèle livré en donnée, édition d'un brouillon, validation à la publication, figé ensuite, version suivante, publications
 * concurrentes), campagnes, isolation A/B, parité SQL/TS de la clé d'identité.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkflow, deleteDraftWorkflow, getWorkflowDetail, listWorkflows, newWorkflowVersion, publishWorkflow, replaceStages, replaceTransitions, updateWorkflow } from "../../application/workflows";
import { closeCampaign, createCampaign, getCampaign, listCampaigns, openCampaign, updateCampaign } from "../../application/campaigns";
import { ensureInstitutionDefaults } from "../../application/defaults";
import { listDecisionReasons, retireConsentText, getSettings, publishConsentText, updateSettings } from "../../application/reference";
import { identityKey } from "../../domain/identity";
import { DEFAULT_STAGES } from "../../domain/default-workflow";
import { describeIntegration } from "../support/db";
import { createWorld, openCampaignWith, unwrap, YEAR_ID, type World } from "../support/world";

describeIntegration("admissions : workflow, campagnes, paramètres", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  it("l'établissement part du modèle livré en donnée : workflow STANDARD publié, statuts canoniques couverts, motifs par défaut", async () => {
    const list = unwrap(await listWorkflows(w.A.deps, w.A.ctx(), w.A.institutionId));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: "STANDARD", version: 1, status: "PUBLISHED" });
    const detail = unwrap(await getWorkflowDetail(w.A.deps, w.A.ctx(), w.A.workflowId));
    const statuses = new Set(detail.stages.map((s) => s.canonicalStatus));
    for (const s of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "MISSING_DOCUMENT", "ACCEPTED", "REJECTED", "WAITLISTED", "ENROLLED"]) expect(statuses.has(s as never), s).toBe(true);
    expect(detail.stages).toHaveLength(DEFAULT_STAGES.length);
    expect(detail.defects).toEqual([]);
    const reasons = unwrap(await listDecisionReasons(w.A.deps, w.A.ctx(), w.A.institutionId));
    expect(reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["ADMITTED", "NO_SEAT", "WITHDRAWN_BY_FAMILY", "OFFER_EXPIRED"]));
  });

  it("l'initialisation est idempotente : rien n'est recréé ni écrasé", async () => {
    const again = unwrap(await ensureInstitutionDefaults(w.A.deps, w.A.ctx(), w.A.institutionId));
    expect(again.workflowCreated).toBe(false);
    expect(again.reasonsCreated).toBe(0);
    expect(again.workflowId).toBe(w.A.workflowId);
  });

  it("modifier = créer la version suivante : le publié est figé (étapes, transitions, libellé), le brouillon se corrige puis se publie", async () => {
    const stages = unwrap(await getWorkflowDetail(w.A.deps, w.A.ctx(), w.A.workflowId)).stages;
    const published = await replaceStages(w.A.deps, w.A.ctx(), w.A.workflowId, { stages: stages.map((s) => ({ ...s })) as never });
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.error.code).toBe("admissions.workflow_not_draft");
    const label = await updateWorkflow(w.A.deps, w.A.ctx(), w.A.workflowId, { label: "Autre libellé" });
    expect(label.ok).toBe(false);

    const v2 = unwrap(await newWorkflowVersion(w.A.deps, w.A.ctx(), w.A.workflowId));
    expect(v2).toMatchObject({ code: "STANDARD", version: 2, status: "DRAFT" });
    expect(v2.stages).toHaveLength(stages.length);
    expect(v2.transitions.length).toBeGreaterThan(10);
    // Une école ajoute SA étape « Commission d'admission » (UNDER_REVIEW) sans changer un seul statut canonique.
    const withCommission = [...v2.stages.map((s) => ({ ...s })), { code: "COMMISSION", label: "Commission d'admission", canonicalStatus: "UNDER_REVIEW", ordinal: 99, isInitial: false, isTerminal: false, holdsSeat: false, requiresConsent: false, requiresDocumentsComplete: false, requiresInterviewDone: false, requiresDecision: false, createsEnrollment: false, closureKind: null, slaHours: 72, notifyTemplateCode: null }];
    const edited = unwrap(await replaceStages(w.A.deps, w.A.ctx(), v2.id, { stages: withCommission as never }));
    expect(edited.stages.map((s) => s.code)).toContain("COMMISSION");
    // L'étape est une impasse tant qu'aucune transition ne la quitte : la publication est REFUSÉE avec la liste des défauts.
    const refused = await publishWorkflow(w.A.deps, w.A.ctx(), v2.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("admissions.workflow_publish_failed");
      const defects = (refused.error.details as { defects: Array<{ code: string }> }).defects.map((d) => d.code);
      expect(defects).toEqual(expect.arrayContaining(["admissions.workflow_dead_end", "admissions.workflow_unreachable"]));
    }
    // On la raccorde : UNDER_REVIEW -> COMMISSION -> ACCEPTED.
    const byCode = new Map(edited.stages.map((s) => [s.code, s.id]));
    const codeOf = new Map(edited.stages.map((s) => [s.id, s.code]));
    const transitions = edited.transitions.map((t) => ({ fromStage: codeOf.get(t.fromStageId)!, toStage: codeOf.get(t.toStageId)!, permissionKey: t.permissionKey, requiresReason: t.requiresReason, isAutomatic: t.isAutomatic }));
    transitions.push({ fromStage: "UNDER_REVIEW", toStage: "COMMISSION", permissionKey: "admission.update", requiresReason: false, isAutomatic: false }, { fromStage: "COMMISSION", toStage: "ACCEPTED", permissionKey: "admission.decide", requiresReason: false, isAutomatic: false });
    void byCode;
    const wired = unwrap(await replaceTransitions(w.A.deps, w.A.ctx(), v2.id, { transitions }));
    expect(wired.defects).toEqual([]);
    const live = unwrap(await publishWorkflow(w.A.deps, w.A.ctx(), v2.id));
    expect(live.status).toBe("PUBLISHED");
    // L'ancienne version est archivée : un seul publié par (établissement, cycle).
    const all = unwrap(await listWorkflows(w.A.deps, w.A.ctx(), w.A.institutionId));
    expect(all.filter((x) => x.status === "PUBLISHED")).toHaveLength(1);
    expect(all.find((x) => x.version === 1)?.status).toBe("ARCHIVED");
    // Figé : plus aucune écriture, y compris par le brouillon supprimé.
    expect((await replaceTransitions(w.A.deps, w.A.ctx(), v2.id, { transitions: [] })).ok).toBe(false);
    expect((await deleteDraftWorkflow(w.A.deps, w.A.ctx(), v2.id)).ok).toBe(false);
  });

  it("publications du même cycle : sérialisées, la version la plus récente l'emporte et une version plus ancienne est refusée", async () => {
    // Ordre déterministe : v3 publiée, puis le brouillon v2 (plus ancien) est REFUSÉ.
    const t = await w.tenant("sequentielle");
    const base = unwrap(await getWorkflowDetail(t.deps, t.ctx(), t.workflowId));
    const a = unwrap(await newWorkflowVersion(t.deps, t.ctx(), base.id));
    const b = unwrap(await newWorkflowVersion(t.deps, t.ctx(), base.id));
    expect([a.version, b.version]).toEqual([2, 3]);
    unwrap(await publishWorkflow(t.deps, t.ctx(), b.id));
    const stale = await publishWorkflow(t.deps, t.ctx(), a.id);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("admissions.workflow_conflict");

    // Deux publications CONCURRENTES : il ne reste jamais qu'un workflow publié, et c'est la version la plus récente.
    const c = await w.tenant("concurrente");
    const root = unwrap(await getWorkflowDetail(c.deps, c.ctx(), c.workflowId));
    const v2 = unwrap(await newWorkflowVersion(c.deps, c.ctx(), root.id));
    const v3 = unwrap(await newWorkflowVersion(c.deps, c.ctx(), root.id));
    const [r2, r3] = await Promise.all([publishWorkflow(c.deps, c.ctx(), v2.id), publishWorkflow(c.deps, c.ctx(), v3.id)]);
    expect(r3.ok).toBe(true);
    if (!r2.ok) expect(r2.error.code).toBe("admissions.workflow_conflict");
    const all = unwrap(await listWorkflows(c.deps, c.ctx(), c.institutionId));
    expect(all.filter((x) => x.status === "PUBLISHED").map((x) => x.version)).toEqual([3]);
  });

  it("un workflow modifié depuis un brouillon neuf peut être supprimé tant qu'il n'est pas publié", async () => {
    const draft = unwrap(await createWorkflow(w.A.deps, w.A.ctx(), { institutionId: w.A.institutionId, code: "BROUILLON", label: "Brouillon vide", from: "EMPTY" }));
    expect(draft.stages).toHaveLength(0);
    expect(unwrap(await deleteDraftWorkflow(w.A.deps, w.A.ctx(), draft.id))).toEqual({ deleted: true });
  });

  it("une campagne ne s'ouvre qu'avec un workflow publié et son workflow est figé dès l'ouverture", async () => {
    const t = await w.tenant("campagnes");
    const draft = unwrap(await createWorkflow(t.deps, t.ctx(), { institutionId: t.institutionId, code: "AUTRE", label: "Autre parcours", from: "TEMPLATE", educationLevelCode: "SECONDAIRE" }));
    const now = Date.now();
    const created = unwrap(await createCampaign(t.deps, t.ctx(), { institutionId: t.institutionId, academicYearId: YEAR_ID, code: "C1", label: "C1", workflowId: draft.id, opensAt: new Date(now - 1000).toISOString(), closesAt: new Date(now + 1e9).toISOString() }));
    const refused = await openCampaign(t.deps, t.ctx(), created.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("admissions.campaign_workflow_not_published");
    unwrap(await publishWorkflow(t.deps, t.ctx(), draft.id));
    const opened = unwrap(await openCampaign(t.deps, t.ctx(), created.id));
    expect(opened.status).toBe("OPEN");
    const swap = await updateCampaign(t.deps, t.ctx(), created.id, { workflowId: t.workflowId });
    expect(swap.ok).toBe(false);
    if (!swap.ok) expect(swap.error.code).toBe("admissions.campaign_workflow_frozen");
    expect(unwrap(await closeCampaign(t.deps, t.ctx(), created.id)).status).toBe("CLOSED");
    // Code de campagne unique par établissement.
    const dup = await createCampaign(t.deps, t.ctx(), { institutionId: t.institutionId, academicYearId: YEAR_ID, code: "C1", label: "bis", workflowId: draft.id, opensAt: new Date(now).toISOString(), closesAt: new Date(now + 1e9).toISOString() });
    expect(dup.ok).toBe(false);
  });

  it("la campagne d'un tenant est invisible d'un autre (RLS)", async () => {
    const campaign = await openCampaignWith(w.A, { seats: { CP1: 3 } });
    expect(unwrap(await getCampaign(w.A.deps, w.A.ctx(), campaign.id)).capacities[0]).toMatchObject({ gradeLevelCode: "CP1", seats: 3, seatsLeft: 3 });
    const foreign = await getCampaign(w.B.deps, w.B.ctx(), campaign.id);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe("admissions.campaign_not_found");
    expect(unwrap(await listCampaigns(w.B.deps, w.B.ctx(), {})).find((c) => c.id === campaign.id)).toBeUndefined();
  });

  it("les textes de consentement sont versionnés : une version publiée ne change plus et ne se supprime pas", async () => {
    const t = await w.tenant("consent");
    const v1 = unwrap(await publishConsentText(t.deps, t.ctx(), { institutionId: t.institutionId, kind: "DATA_PROCESSING", version: "2026.1", language: "fr", body: "Premier texte de consentement parental (v1)." }, { designate: true }));
    expect(v1.version).toBe("2026.1");
    const again = await publishConsentText(t.deps, t.ctx(), { institutionId: t.institutionId, kind: "DATA_PROCESSING", version: "2026.1", language: "fr", body: "Texte modifié en cachette, longueur suffisante." });
    expect(again.ok).toBe(false);
    const { rows } = await w.db.admin.query("UPDATE admissions.consent_texts SET body = 'altéré par un accès direct, longueur suffisante' WHERE id = $1", [v1.id]).catch((e: Error) => ({ rows: [e.message] }));
    expect(String(rows[0])).toContain("consent_text_immutable");
    // Le texte désigné d'un formulaire OUVERT ne se retire pas.
    unwrap(await updateSettings(t.deps, t.ctx(), { institutionId: t.institutionId, publicFormEnabled: true }));
    const retire = await retireConsentText(t.deps, t.ctx(), { institutionId: t.institutionId, kind: "DATA_PROCESSING", version: "2026.1" });
    expect(retire.ok).toBe(false);
    // Sans texte désigné, le formulaire public ne peut pas s'ouvrir.
    const t2 = await w.tenant("consent2");
    const open = await updateSettings(t2.deps, t2.ctx(), { institutionId: t2.institutionId, publicFormEnabled: true });
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.error.code).toBe("admissions.consent_text_missing");
    expect(unwrap(await getSettings(t2.deps, t2.ctx(), t2.institutionId)).publicFormEnabled).toBe(false);
  });

  it("la clé d'identité calculée par le code est celle de la colonne générée par la base (parité SQL/TS)", async () => {
    const t = await w.tenant("identite");
    const campaign = await openCampaignWith(t);
    const { createApplication } = await import("../../application/applications");
    const { applicationBody } = await import("../support/world");
    const body = applicationBody(campaign.id, { applicantLastName: "N'Guessan-Kouamé", applicantFirstName: "Éloïse  Marie", applicantBirthDate: "2018-12-31" });
    const created = unwrap(await createApplication(t.deps, t.ctx(), body));
    const { rows } = await w.db.admin.query("SELECT identity_key FROM admissions.applications WHERE id = $1", [created.id]);
    expect(rows[0].identity_key).toBe(identityKey({ lastName: body.applicantLastName, firstName: body.applicantFirstName, birthDate: body.applicantBirthDate }));
  });
});
