/**
 * Contrôles (faits fournis par `attendance`, jamais calculés ici), pièces (références vers la GED), réglages, formats d'export
 * en données et exports CSV (injection de formule neutralisée, troncature signalée), sur une base réelle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actOnAssignment, recordAssignment } from "../../application/assignments";
import { completeControl, getAttendanceFacts, listControlsReport, notifyDueControls, planControl, planRequiredControls, resolveControlAnomaly, waiveControl } from "../../application/controls";
import { createStateassignDeps } from "../../application/deps";
import { addAssignmentDocument, withdrawAssignmentDocument } from "../../application/documents";
import { RecordingAudit } from "../../application/ports";
import { reconcileAssignment } from "../../application/reconciliation";
import { scheduleReceivable } from "../../application/receivables";
import { createFormat, exportCsv, getExportCatalog, listFormats, updateFormat } from "../../application/reports";
import { getInstitutionSettings, updateInstitutionSettings } from "../../application/settings";
import { billingOf } from "../../infrastructure/in-memory-ports";
import { PEOPLE, createEnv, errorCodeOf, outboxPayloads, outboxTypes, unwrapOk, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
beforeAll(async () => {
  env = await createEnv({ startAt: "2026-12-20T09:00:00.000Z" });
});
afterAll(async () => {
  await env?.close();
});

const human = (t: string, who: string = PEOPLE.bursar) => env.user(t, who);

async function activeDossier(t: string, over: { institutionId?: string; yearId?: string; studentName?: string } = {}) {
  const e = env.enroll({ ...(over.institutionId ? { institutionId: over.institutionId } : {}), ...(over.yearId ? { yearId: over.yearId } : {}), ...(over.studentName ? { studentName: over.studentName } : {}) });
  const a = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: `AFF-${uuid().slice(0, 6)}`, declaredStateAmount: 400000, declaredParentAmount: 100000 }));
  unwrapOk(await actOnAssignment(env.deps, human(t), a.id, "verify", {}));
  unwrapOk(await actOnAssignment(env.deps, human(t), a.id, "activate", {}));
  return { ...e, id: a.id };
}

describeIntegration("stateassign : contrôles d'un dossier", () => {
  it("planifier : humain, sur un dossier vérifié ou actif ; un contrôle par nature et période ; contrôle dû signalé une seule fois", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    const period = uuid();
    const c = unwrapOk(await planControl(env.deps, human(t), d.id, { kind: "ATTENDANCE", academicPeriodId: period, dueOn: "2026-12-15" }));
    expect(c).toMatchObject({ status: "PENDING", kind: "ATTENDANCE", dueOn: "2026-12-15", overdue: true }); // 20 décembre : échéance dépassée
    expect(errorCodeOf(await planControl(env.deps, human(t), d.id, { kind: "ATTENDANCE", academicPeriodId: period, dueOn: "2026-12-30" }))).toBe("stateassign.duplicate_control");
    expect(errorCodeOf(await planControl(env.deps, env.system(t), d.id, { kind: "IDENTITY", dueOn: "2026-12-30" }))).toBe("stateassign.human_actor_required");
    const e = env.enroll();
    const received = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "R-CTL", declaredStateAmount: 1 }));
    expect(errorCodeOf(await planControl(env.deps, human(t), received.id, { kind: "IDENTITY", dueOn: "2026-12-30" }))).toBe("stateassign.control_state");

    expect((await notifyDueControls(env.deps, env.system(t))).notified).toBe(1);
    expect((await notifyDueControls(env.deps, env.system(t))).notified).toBe(0);
    const due = (await outboxPayloads(env.db, "stateassign.control.due")).filter((p) => p.controlId === c.id);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ v: 1, kind: "ATTENDANCE", status: "PENDING", dueOn: "2026-12-15", enrollmentId: d.enrollmentId });
  });

  it("réaliser un contrôle de présence : les faits viennent d'attendance (jamais calculés ici) ; anomalie = constat obligatoire ; événements publiés", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    const period = uuid();
    env.world.setAttendance(d.enrollmentId, period, { absentMinutes: 540, excusedMinutes: 120, lateCount: 3 });
    const c = unwrapOk(await planControl(env.deps, human(t), d.id, { kind: "ATTENDANCE", academicPeriodId: period, dueOn: "2026-12-31" }));
    expect(unwrapOk(await getAttendanceFacts(env.deps, human(t), d.id, period))).toEqual({ absentMinutes: 540, excusedMinutes: 120, lateCount: 3, periodId: period });
    expect(errorCodeOf(await completeControl(env.deps, human(t), c.id, { outcome: "ANOMALY", findings: "ko" }))).toBe("stateassign.invalid_input");
    expect(errorCodeOf(await completeControl(env.deps, env.system(t), c.id, { outcome: "OK" }))).toBe("stateassign.human_actor_required");
    const done = unwrapOk(await completeControl(env.deps, human(t), c.id, { outcome: "ANOMALY", findings: "Absences non justifiées au-delà du suivi" }));
    expect(done).toMatchObject({ status: "ANOMALY", performedBy: PEOPLE.bursar });
    expect(done.evidence).toEqual({ attendance: { available: true, source: "attendance", absentMinutes: 540, excusedMinutes: 120, lateCount: 3, periodId: period } });
    expect(await outboxTypes(env.db, c.id)).toEqual(["stateassign.control.performed", "stateassign.control.anomaly_detected"]);
    expect(env.audit.entries.find((e) => e.action === "stateassign.control.performed" && e.resourceId === c.id)).toMatchObject({ sensitive: true });
    // résolution de l'anomalie : motif obligatoire, par un humain
    expect(errorCodeOf(await resolveControlAnomaly(env.deps, human(t), c.id, { resolution: "ko" }))).toBe("stateassign.invalid_input");
    expect(unwrapOk(await resolveControlAnomaly(env.deps, human(t), c.id, { resolution: "Justificatifs reçus et validés" }))).toMatchObject({ status: "OK", anomalyResolution: "Justificatifs reçus et validés" });
    expect(errorCodeOf(await resolveControlAnomaly(env.deps, human(t), c.id, { resolution: "Encore une fois" }))).toBe("stateassign.control_transition");
    expect(errorCodeOf(await completeControl(env.deps, human(t), c.id, { outcome: "OK" }))).toBe("stateassign.control_transition");
  });

  it("aucun fait de présence disponible : consigné tel quel (available: false), jamais inventé ; port absent : échec fermé, le contrôle reste à faire", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    const noFacts = unwrapOk(await planControl(env.deps, human(t), d.id, { kind: "ATTENDANCE", academicPeriodId: uuid(), dueOn: "2026-12-31" }));
    expect(unwrapOk(await completeControl(env.deps, human(t), noFacts.id, { outcome: "OK" })).evidence).toEqual({ attendance: { available: false, source: "attendance" } });

    const other = unwrapOk(await planControl(env.deps, human(t), d.id, { kind: "ATTENDANCE", academicPeriodId: uuid(), dueOn: "2026-12-31" }));
    const bare = createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: new RecordingAudit(), ports: { ...env.world, attendance: undefined as never } });
    expect(errorCodeOf(await completeControl(bare, human(t), other.id, { outcome: "OK" }))).toBe("stateassign.port_unavailable");
    const row = await env.db.admin.query("SELECT status FROM stateassign.controls WHERE id = $1", [other.id]);
    expect(row.rows[0].status).toBe("PENDING");
    // dispenser (WAIVED) reste possible : motif obligatoire, acte humain, audité
    expect(errorCodeOf(await waiveControl(env.deps, human(t), other.id, { reason: "ko" }))).toBe("stateassign.invalid_input");
    expect(unwrapOk(await waiveControl(env.deps, human(t), other.id, { reason: "Élève en stage hors établissement" }))).toMatchObject({ status: "WAIVED", findings: "Élève en stage hors établissement" });
    expect(errorCodeOf(await waiveControl(env.deps, human(t), other.id, { reason: "Encore dispensé" }))).toBe("stateassign.control_transition");
  });

  it("contrôle financier : l'instantané de rapprochement déjà calculé est consigné (entiers), pas recalculé", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 390000, parentTotal: 100000 }));
    unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    const c = unwrapOk(await planControl(env.deps, human(t), d.id, { kind: "FINANCE_RECONCILIATION", dueOn: "2026-12-31" }));
    const done = unwrapOk(await completeControl(env.deps, human(t), c.id, { outcome: "OK" }));
    expect(done.evidence).toMatchObject({ reconciliation: { status: "DISCREPANCY", stateDelta: -10000, parentDelta: 0, currency: "XOF" } });
  });

  it("planification selon les réglages : RIEN par défaut ; ensuite par période échue / une fois, de façon idempotente ; un job ne réalise jamais un contrôle", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const d = await activeDossier(t, { institutionId: inst, yearId: year });
    env.world.periodsByYear.set(year, [
      { id: uuid(), label: "Trimestre 1", startsOn: "2026-09-01", endsOn: "2026-12-15" },
      { id: uuid(), label: "Trimestre 2", startsOn: "2026-12-16", endsOn: "2027-03-15" },
    ]);
    expect((await planRequiredControls(env.deps, env.system(t))).planned).toBe(0); // aucun réglage : aucun contrôle
    expect(errorCodeOf(await updateInstitutionSettings(env.deps, env.system(t), inst, { requireSeparateVerifier: true, reconciliationTolerance: 0, requiredControlKinds: ["ATTENDANCE", "IDENTITY"], controlDueOffsetDays: 10, receivableGraceDays: 0 }))).toBe("stateassign.human_actor_required");
    unwrapOk(await updateInstitutionSettings(env.deps, env.user(t, PEOPLE.director), inst, { requireSeparateVerifier: true, reconciliationTolerance: 0, requiredControlKinds: ["ATTENDANCE", "IDENTITY"], controlDueOffsetDays: 10, receivableGraceDays: 0 }));
    const first = await planRequiredControls(env.deps, env.system(t));
    expect(first).toMatchObject({ examined: 1, planned: 2, failed: 0 }); // présence du T1 (échu) + identité
    expect((await planRequiredControls(env.deps, env.system(t))).planned).toBe(0); // idempotent
    env.clock.set("2027-03-20T09:00:00.000Z");
    expect((await planRequiredControls(env.deps, env.system(t))).planned).toBe(1); // présence du T2, désormais échu
    env.clock.set("2026-12-20T09:00:00.000Z");
    const rows = await env.db.admin.query("SELECT kind, status, to_char(due_on,'YYYY-MM-DD') due, created_by FROM stateassign.controls WHERE assignment_id = $1 ORDER BY due_on", [d.id]);
    const byKind = (k: string) => rows.rows.filter((r: { kind: string }) => r.kind === k).map((r: { due: string }) => r.due);
    expect(byKind("ATTENDANCE")).toEqual(["2026-12-25", "2027-03-25"]);
    expect(byKind("IDENTITY")).toHaveLength(1);
    expect(rows.rows.every((r: { status: string }) => r.status === "PENDING")).toBe(true);
    expect(rows.rows.every((r: { created_by: string | null }) => r.created_by === null)).toBe(true); // planifié par la règle, jamais « réalisé »
    // l'état des contrôles à faire
    const report = unwrapOk(await listControlsReport(env.deps, human(t), { institutionId: inst, kind: "ATTENDANCE", page: 1, pageSize: 50 }));
    expect(report.total).toBe(2);
    expect(report.items[0]).toMatchObject({ assignmentStatus: "ACTIVE", control: { status: "PENDING" } });
  });
});

describeIntegration("stateassign : pièces du dossier", () => {
  const caps = { read: true, readRestricted: true, manage: false };

  it("rattache une RÉFÉRENCE de la GED (jamais le fichier) : document inconnu refusé, doublon refusé, retrait motivé, historique conservé", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    const doc = uuid();
    env.world.documentIds.add(doc);
    expect(errorCodeOf(await addAssignmentDocument(env.deps, human(t), d.id, { kind: "ASSIGNMENT_ORDER", documentRef: uuid() }, caps))).toBe("stateassign.document_ref_not_found");
    const added = unwrapOk(await addAssignmentDocument(env.deps, human(t), d.id, { kind: "ASSIGNMENT_ORDER", documentRef: doc, label: "Acte d'affectation", receivedOn: "2026-09-20" }, caps));
    expect(added).toMatchObject({ kind: "ASSIGNMENT_ORDER", documentRef: doc, status: "ACTIVE", addedBy: PEOPLE.bursar });
    expect(errorCodeOf(await addAssignmentDocument(env.deps, human(t), d.id, { kind: "OTHER", documentRef: doc }, caps))).toBe("stateassign.duplicate_document");
    expect(errorCodeOf(await addAssignmentDocument(env.deps, env.system(t), d.id, { kind: "OTHER", documentRef: doc }, caps))).toBe("stateassign.human_actor_required");
    expect(errorCodeOf(await withdrawAssignmentDocument(env.deps, human(t), added.id, { reason: "ko" }))).toBe("stateassign.invalid_input");
    const withdrawn = unwrapOk(await withdrawAssignmentDocument(env.deps, human(t), added.id, { reason: "Pièce remplacée par l'original" }));
    expect(withdrawn).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "Pièce remplacée par l'original", withdrawnBy: PEOPLE.bursar });
    expect(errorCodeOf(await withdrawAssignmentDocument(env.deps, human(t), added.id, { reason: "Retrait répété" }))).toBe("stateassign.transition_invalid");
    expect(env.audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["stateassign.document.added", "stateassign.document.withdrawn"]));
  });

  it("la lisibilité du document est vérifiée avec les droits de l'appelant : sans port documents, échec fermé", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    const bare = createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: new RecordingAudit(), ports: { ...env.world, documents: undefined as never } });
    expect(errorCodeOf(await addAssignmentDocument(bare, human(t), d.id, { kind: "OTHER", documentRef: uuid() }, caps))).toBe("stateassign.port_unavailable");
  });
});

describeIntegration("stateassign : réglages, formats d'export et exports", () => {
  it("réglages : valeurs prudentes par défaut ; modifier est un acte humain, sensible, audité", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const def = unwrapOk(await getInstitutionSettings(env.deps, human(t), inst));
    expect(def).toEqual({ institutionId: inst, isDefault: true, requireSeparateVerifier: true, reconciliationTolerance: 0, requiredControlKinds: [], controlDueOffsetDays: null, receivableGraceDays: 0, updatedAt: null });
    const saved = unwrapOk(await updateInstitutionSettings(env.deps, env.user(t, PEOPLE.director), inst, { requireSeparateVerifier: false, reconciliationTolerance: 500, requiredControlKinds: ["IDENTITY", "IDENTITY"], controlDueOffsetDays: 7, receivableGraceDays: 30 }));
    expect(saved).toMatchObject({ isDefault: false, requireSeparateVerifier: false, reconciliationTolerance: 500, requiredControlKinds: ["IDENTITY"], controlDueOffsetDays: 7, receivableGraceDays: 30 });
    expect(env.audit.entries.at(-1)).toMatchObject({ action: "stateassign.settings.updated", sensitive: true });
    const scoped = env.user(t, PEOPLE.director, { institutionId: uuid() });
    expect(errorCodeOf(await getInstitutionSettings(env.deps, scoped, inst))).toBeDefined();
  });

  it("formats d'export en DONNÉES : catalogue de colonnes, validation des clés, code unique par établissement, activation", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const catalog = getExportCatalog();
    expect(catalog.datasets.map((x) => x.dataset)).toEqual(["ASSIGNMENTS", "RECEIVABLES", "CONTROLS"]);
    expect(unwrapOk(await listFormats(env.deps, human(t), { institutionId: inst })).items).toEqual([]); // aucun format livré
    const body = { institutionId: inst, code: "etat-admin", label: "État pour l'administration", dataset: "ASSIGNMENTS" as const, columns: [{ key: "reference", header: "N° d'acte" }, { key: "studentName", header: "Nom" }, { key: "declaredStateAmount", header: "Part État" }], delimiter: ";" as const, includeBom: true };
    expect(errorCodeOf(await createFormat(env.deps, env.system(t), body))).toBe("stateassign.human_actor_required");
    expect(errorCodeOf(await createFormat(env.deps, human(t), { ...body, columns: [{ key: "inconnue", header: "X" }] }))).toBe("stateassign.export_column_unknown");
    const created = unwrapOk(await createFormat(env.deps, human(t), body));
    expect(created).toMatchObject({ code: "etat-admin", dataset: "ASSIGNMENTS", active: true });
    expect(errorCodeOf(await createFormat(env.deps, human(t), body))).toBe("stateassign.duplicate_export_format");
    const upd = unwrapOk(await updateFormat(env.deps, human(t), created.id, { columns: [{ key: "reference", header: "Réf" }], delimiter: "," }));
    expect(upd).toMatchObject({ columns: [{ key: "reference", header: "Réf" }], delimiter: "," });
    expect(errorCodeOf(await updateFormat(env.deps, human(t), created.id, { columns: [{ key: "dueOn", header: "X" }] }))).toBe("stateassign.export_column_unknown");
    expect(errorCodeOf(await updateFormat(env.deps, human(t), uuid(), { label: "x" }))).toBe("stateassign.export_format_not_found");
  });

  it("export CSV : colonnes du format, injection de formule neutralisée (nom d'élève, libellé), montants entiers, audité", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const d = await activeDossier(t, { institutionId: inst, yearId: year, studentName: "=HYPERLINK(\"http://x\";\"Cliquer\")" });
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    unwrapOk(await scheduleReceivable(env.deps, human(t), d.id, { label: "+1 versement; « test »", dueOn: "2026-11-15", expectedAmount: 150000 }));
    const fmt = unwrapOk(await createFormat(env.deps, human(t), { institutionId: inst, code: "etat-admin", label: "Format", dataset: "ASSIGNMENTS", columns: [{ key: "reference", header: "N° d'acte" }, { key: "studentName", header: "Nom" }, { key: "declaredStateAmount", header: "Part État" }, { key: "stateDelta", header: "Écart" }], delimiter: ";", includeBom: true }));
    const out = unwrapOk(await exportCsv(env.deps, human(t), { dataset: "ASSIGNMENTS", formatId: fmt.id, institutionId: inst }));
    expect(out.body.startsWith("﻿")).toBe(true);
    const [header, row] = out.body.slice(1).trim().split("\r\n");
    expect(header).toBe("N° d'acte;Nom;Part État;Écart");
    expect(row!.split(";")[1]!.startsWith("\"'=HYPERLINK") || row!.includes("'=HYPERLINK")).toBe(true); // jamais une formule exécutable
    expect(row).toContain(";400000;0");
    expect(out.meta).toEqual({ dataset: "ASSIGNMENTS", rowCount: 1, totalCount: 1, truncated: false, maxRows: 50000 });
    expect(out.filename).toBe("stateassign-assignments-2026-12-20.csv");
    // créances : format neutre intégré, libellé « +… » neutralisé, entiers
    const rec = unwrapOk(await exportCsv(env.deps, human(t), { dataset: "RECEIVABLES", institutionId: inst }));
    expect(rec.body).toContain("'+1 versement");
    expect(rec.body).toContain(";150000;0;150000;XOF;OPEN;");
    // un format d'un autre jeu est refusé ; un format inconnu aussi
    expect(errorCodeOf(await exportCsv(env.deps, human(t), { dataset: "RECEIVABLES", formatId: fmt.id }))).toBe("stateassign.invalid_input");
    expect(errorCodeOf(await exportCsv(env.deps, human(t), { dataset: "RECEIVABLES", formatId: uuid() }))).toBe("stateassign.export_format_not_found");
    expect(env.audit.entries.filter((e) => e.action === "stateassign.export.generated").length).toBeGreaterThanOrEqual(2);
    expect([...env.audit.entries].reverse().find((e) => e.action === "stateassign.export.generated")).toMatchObject({ sensitive: true, metadata: { dataset: "RECEIVABLES", rows: 1 } });
    // périmètre d'établissement
    expect(errorCodeOf(await exportCsv(env.deps, env.user(t, PEOPLE.bursar, { institutionId: uuid() }), { dataset: "ASSIGNMENTS", institutionId: inst }))).toBeDefined();
  });

  it("export tronqué ET signalé au-delà du plafond de lignes", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    for (let i = 0; i < 3; i += 1) await activeDossier(t, { institutionId: inst, yearId: year });
    const small = createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: new RecordingAudit(), ports: env.world, config: { exportMaxRows: 2 } });
    const out = unwrapOk(await exportCsv(small, human(t), { dataset: "ASSIGNMENTS", institutionId: inst, academicYearId: year }));
    expect(out.meta).toEqual({ dataset: "ASSIGNMENTS", rowCount: 2, totalCount: 3, truncated: true, maxRows: 2 });
    expect(out.body.trim().split("\r\n")).toHaveLength(3); // en-tête + 2 lignes
  });
});
