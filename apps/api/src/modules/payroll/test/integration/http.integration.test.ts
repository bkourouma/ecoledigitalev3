/**
 * API HTTP `/api/v1/payroll/*` (Fastify `inject` + Postgres réel) : authentification, autorisation, MATRICE D'ACCÈS
 * au bulletin (gestion, propriétaire, titulaire, autre enseignant, élève, parent, autre tenant), validation Zod,
 * erreurs normalisées, contrats de réponse, fonctionnalités du plan, routes supprimées (purge, statut libre).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId } from "@ecoledigitale/kernel";
import {
  payrollBatchResultDtoSchema,
  payrollCalculationReportDtoSchema,
  payrollConfigDtoSchema,
  payrollOwnerMassDtoSchema,
  payrollPayslipDataDtoSchema,
  payrollPayslipDetailDtoSchema,
  payrollPayslipDtoSchema,
  payrollPayslipPageDtoSchema,
  payrollPeriodDtoSchema,
  payrollResolvedRateDtoSchema,
  payrollRunDtoSchema,
  payrollSettingsDtoSchema,
  payrollSummaryDtoSchema,
} from "@ecoledigitale/contracts/src/v2/payroll";
import manifest from "../../manifest";
import { payrollPlugin } from "../../http/plugin";
import { calculatePeriod } from "../../application/calculate";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addRate, addStaff, attendance, createWorld, payslipRows, session, unwrap, type World } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);
const MANAGER = ALL.filter((p) => p !== "payroll.payslip.read_own" && p !== "payroll.payslip.approve_owner");
const OWNER = ALL.filter((p) => p !== "payroll.payslip.read_own");
const TEACHER = ["payroll.payslip.read_own"];

interface CallOptions {
  user?: string | null;
  perms?: string[];
  body?: unknown;
  query?: Record<string, string>;
  tenant?: string | "none";
  headers?: Record<string, string>;
}

describeIntegration("API HTTP /api/v1/payroll/*", () => {
  let db: PayrollTestDb;
  let w: World;
  let other: World;
  let app: FastifyInstance;
  let features: Set<string>;
  const manager = newId();
  const teacherUser = newId();
  const otherTeacherUser = newId();
  const studentUser = newId();
  const parentUser = newId();
  let teacher: string;
  let otherTeacher: string;
  let periodId: string;
  let slipCalc: string; // CALCULATED de `teacher`
  let slipPaid: string; // PAID de `teacher`
  let slipOtherApproved: string; // APPROVED de `otherTeacher`

  beforeAll(async () => {
    db = await createPayrollTestDb(24);
    w = await createWorld({ db });
    other = await createWorld({ db });
    features = new Set(["payroll.core", "payroll.owner-validation", "payroll.session-source", "payroll.attendance-source"]);
    teacher = addStaff(w, "Awa Titulaire", { userId: teacherUser, matricule: "T-001" });
    otherTeacher = addStaff(w, "Bob Autre", { userId: otherTeacherUser });
    await addConfig(w, { staffId: teacher });
    await addConfig(w, { staffId: otherTeacher });

    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: typeof user === "string" && user !== "" ? user : newId(), roles: [] });
      }
    });
    await app.register(payrollPlugin, {
      deps: w.deps,
      prefix: "/api/v1/payroll",
      requirePermission: (permission) => async (req) => {
        const ctx = (req as unknown as { ctx?: unknown }).ctx;
        if (!ctx) throw new UnauthorizedError();
        const granted = String(req.headers["x-test-perms"] ?? "").split(",");
        if (!granted.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      requireFeature: (feature) => async (_req, reply) => {
        if (!features.has(feature)) return reply.status(403).send({ status: 403, code: "entitlements.feature_not_available", kind: "forbidden", message: "Fonctionnalité non incluse.", details: { feature } });
        return undefined;
      },
      isFeatureEnabled: async (_ctx, feature) => features.has(feature),
    });
    await app.ready();

    // Jeu de données : 3 bulletins du tenant `w` (période en cours)
    const p = await addPeriod(w);
    periodId = p.id;
    w.mem.sessions.add(session(teacher, "2026-01-06", 120), session(otherTeacher, "2026-01-06", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId }));
    const slips = await payslipRows(w);
    slipCalc = slips.find((s) => s.staff_id === teacher)?.id;
    slipOtherApproved = slips.find((s) => s.staff_id === otherTeacher)?.id;
    // `slipPaid` : un second bulletin payé du titulaire, sur une autre période
    await db.admin.query("UPDATE payroll.pay_periods SET awaiting_calculation=false WHERE tenant_id=$1", [w.tenantId]);
    const p2 = await addPeriod(w, { startDate: "2026-02-02", endDate: "2026-02-27" });
    w.mem.sessions.add(session(teacher, "2026-02-03", 180));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p2.id }));
    slipPaid = (await payslipRows(w, "period_id=$2 AND staff_id=$3", [p2.id, teacher]))[0]?.id;
    await call("POST", "/payslips/approve", { perms: OWNER, body: { payslipIds: [slipPaid, slipOtherApproved] } });
    await call("POST", "/payslips/pay", { perms: OWNER, body: { payslipIds: [slipPaid], method: "CASH" } });
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, o: CallOptions = {}) {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.tenant !== "none") headers["x-test-tenant"] = o.tenant ?? w.tenantId;
    if (o.user !== null) headers["x-test-user"] = o.user ?? manager;
    headers["x-test-perms"] = (o.perms ?? MANAGER).join(",");
    let payload: string | undefined;
    if (o.body !== undefined) {
      payload = JSON.stringify(o.body);
      headers["content-type"] = "application/json";
    }
    const res = await app.inject({ method, url: `/api/v1/payroll${url}`, headers, payload, query: o.query });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = null;
    }
    return { status: res.statusCode, json, text: res.body, headers: res.headers };
  }

  // ---- authentification et fonctionnalités ------------------------------------------------------------------
  it("401 sans contexte ; 403 sans permission ; 403 si la fonctionnalité du plan n'est pas accordée", async () => {
    expect((await call("GET", "/payslips", { tenant: "none" })).status).toBe(401);
    const noPerm = await call("GET", "/payslips", { perms: [] });
    expect(noPerm.status).toBe(403);
    features.delete("payroll.core");
    const noFeature = await call("GET", "/payslips");
    expect(noFeature.status).toBe(403);
    expect(noFeature.json.code).toBe("entitlements.feature_not_available");
    features.add("payroll.core");
    features.delete("payroll.owner-validation");
    expect((await call("GET", "/owner/mass")).status).toBe(403);
    features.add("payroll.owner-validation");
  });

  // ---- MATRICE D'ACCÈS (T16) -----------------------------------------------------------------------------------
  describe("matrice d'accès au bulletin", () => {
    const personas = () => [
      { name: "gestion", user: manager, perms: MANAGER, tenant: undefined },
      { name: "propriétaire", user: newId(), perms: OWNER, tenant: undefined },
      { name: "titulaire", user: teacherUser, perms: TEACHER, tenant: undefined },
      { name: "autre enseignant", user: otherTeacherUser, perms: TEACHER, tenant: undefined },
      { name: "élève", user: studentUser, perms: [] as string[], tenant: undefined },
      { name: "parent", user: parentUser, perms: [] as string[], tenant: undefined },
    ];
    const status = async (p: ReturnType<typeof personas>[number], url: string, method: "GET" | "POST" = "GET", body?: unknown) =>
      (await call(method, url, { user: p.user, perms: p.perms, ...(p.tenant ? { tenant: p.tenant } : {}), ...(body !== undefined ? { body } : {}) })).status;

    it("détail et données d'un bulletin ARRÊTÉ/PAYÉ : gestion et titulaire seulement ; autre enseignant, élève, parent : 403", async () => {
      for (const url of [`/payslips/${slipPaid}`, `/payslips/${slipPaid}/data`]) {
        const got: Record<string, number> = {};
        for (const p of personas()) got[p.name] = await status(p, url);
        expect(got, url).toEqual({ gestion: 200, propriétaire: 200, titulaire: 200, "autre enseignant": 403, élève: 403, parent: 403 });
      }
    });

    it("un brouillon CALCULÉ n'est pas lisible par son titulaire (gestion seule) ; ni les bulletins des autres", async () => {
      const got: Record<string, number> = {};
      for (const p of personas()) got[p.name] = await status(p, `/payslips/${slipCalc}`);
      expect(got).toEqual({ gestion: 200, propriétaire: 200, titulaire: 403, "autre enseignant": 403, élève: 403, parent: 403 });
      // le titulaire de slipOtherApproved est `otherTeacher` : le premier enseignant ne le lit pas
      expect((await call("GET", `/payslips/${slipOtherApproved}`, { user: teacherUser, perms: TEACHER })).status).toBe(403);
      expect((await call("GET", `/payslips/${slipOtherApproved}/data`, { user: otherTeacherUser, perms: TEACHER })).status).toBe(200);
    });

    it("liste complète, historique, rapports, notification : gestion seulement ; un enseignant ne peut pas les appeler", async () => {
      const urls: Array<[string, "GET" | "POST"]> = [["/payslips", "GET"], ["/history", "GET"], ["/reports/summary", "GET"], [`/payslips/${slipPaid}/notify`, "POST"]];
      for (const [url, method] of urls) {
        expect(await status(personas()[2] as never, url, method), `${method} ${url} titulaire`).toBe(403);
        expect(await status(personas()[4] as never, url, method), `${method} ${url} élève`).toBe(403);
      }
      expect(await status(personas()[0] as never, `/payslips/${slipPaid}/notify`, "POST")).toBe(202);
    });

    it("/my/* : l'identité vient du COMPTE ; aucun paramètre teacherId n'est pris en compte (T16)", async () => {
      const mine = await call("GET", "/my/payslips", { user: teacherUser, perms: TEACHER, query: { teacherId: otherTeacher, staffId: otherTeacher } });
      expect(mine.status).toBe(200);
      const items = mine.json.items as Array<{ staffId: string; status: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.staffId === teacher)).toBe(true);
      expect(items.every((i) => ["APPROVED", "DISPUTED", "PAID"].includes(i.status))).toBe(true); // jamais un brouillon
      const theirs = await call("GET", "/my/payslips", { user: otherTeacherUser, perms: TEACHER, query: { teacherId: teacher } });
      expect((theirs.json.items as Array<{ staffId: string }>).every((i) => i.staffId === otherTeacher)).toBe(true);
      // détail personnel : le sien seulement
      expect((await call("GET", `/my/payslips/${slipPaid}`, { user: teacherUser, perms: TEACHER })).status).toBe(200);
      expect((await call("GET", `/my/payslips/${slipPaid}`, { user: otherTeacherUser, perms: TEACHER })).status).toBe(403);
      // sans lien avec un membre du personnel : refusé
      expect((await call("GET", "/my/payslips", { user: studentUser, perms: TEACHER })).status).toBe(403);
      // la gestion passe par /payslips/:id, jamais par /my
      expect((await call("GET", "/my/payslips", { user: manager, perms: MANAGER })).status).toBe(403);
    });

    it("un autre TENANT ne voit rien : 404 sur le bulletin, liste vide", async () => {
      const r = await call("GET", `/payslips/${slipPaid}`, { tenant: other.tenantId });
      expect(r.status).toBe(404);
      const list = await call("GET", "/payslips", { tenant: other.tenantId });
      expect(list.json.items).toEqual([]);
      expect((await call("GET", `/payslips/${slipPaid}/data`, { tenant: other.tenantId, user: teacherUser, perms: TEACHER })).status).toBe(404);
    });

    it("l'arrêt, le versement, l'annulation, l'ajustement exigent leur permission propre", async () => {
      for (const [url, body] of [
        ["/payslips/approve", { payslipIds: [slipCalc] }],
        ["/payslips/pay", { payslipIds: [slipCalc], method: "CASH" }],
        [`/payslips/${slipCalc}/cancel`, { reason: "Test de droits" }],
        [`/payslips/${slipCalc}/dispute`, { reason: "Test de droits" }],
      ] as const) {
        expect((await call("POST", url, { perms: ["payroll.payslip.read"], body })).status, url).toBe(403);
        expect((await call("POST", url, { perms: TEACHER, user: teacherUser, body })).status, url).toBe(403);
      }
      expect((await call("PATCH", `/payslips/${slipCalc}/adjustments`, { perms: ["payroll.payslip.read"], body: { add: [{ kind: "BONUS", amount: 1, label: "x" }] } })).status).toBe(403);
    });
  });

  // ---- routes supprimées -----------------------------------------------------------------------------------------
  it("aucune route de purge (R-PAY-17), aucun PATCH de statut libre, aucune création manuelle de bulletin (critère de sortie 5)", async () => {
    expect((await call("POST", "/periods/purge-dev", { body: {} })).status).toBe(404);
    expect((await call("DELETE", "/periods/purge-dev")).status).toBe(404);
    expect((await call("PATCH", `/payslips/${slipCalc}/status`, { body: { status: "paid" } })).status).toBe(404);
    expect((await call("POST", "/payslips", { body: { staffId: teacher } })).status).toBe(404);
    expect((await call("DELETE", `/payslips/${slipCalc}`)).status).toBe(404);
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/purge/);
    expect(routes).not.toMatch(/status/);
  });

  // ---- contrats -------------------------------------------------------------------------------------------------------
  it("réglages, configurations, tarifs, simulateur : réponses conformes aux contrats", async () => {
    const s = await call("GET", "/settings");
    expect(payrollSettingsDtoSchema.safeParse(s.json).success).toBe(true);
    const upd = await call("PUT", "/settings", { body: { defaultOvertimeThresholdMinutes: 2400, requireSeparateApprover: false } });
    expect(upd.status).toBe(200);
    const staff = addStaff(w, "Config Http");
    const created = await call("POST", "/configs", { body: { staffId: staff, type: "MIXED", monthlySalary: 200_000, defaultHourlyRate: 8000, effectiveFrom: "2025-09-01" } });
    expect(created.status).toBe(201);
    expect(payrollConfigDtoSchema.safeParse(created.json).success).toBe(true);
    expect(created.json).toMatchObject({ type: "MIXED", monthlySalary: 200_000, overtimeThresholdMinutes: 2400, overtimeMultiplierPermille: 1500 });
    const cur = await call("GET", `/staff/${staff}/config/current`, { query: { onDate: "2026-01-15" } });
    expect(cur.json).toMatchObject({ state: "ACTIVE" });
    expect((await call("GET", `/staff/${staff}/config/current`, { query: { onDate: "2025-01-15" } })).json.state).toBe("FUTURE");
    expect((await call("GET", `/staff/${newId()}/config/current`)).json).toEqual({ state: "ABSENT", config: null });
    const node = newId();
    const rate = await call("POST", "/rates", { body: { curriculumNodeId: node, rate: 9000, validFrom: "2025-09-01" } });
    expect(rate.status).toBe(201);
    const dup = await call("POST", "/rates", { body: { curriculumNodeId: node, rate: 9500, validFrom: "2025-10-01" } });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe("payroll.rate_overlap");
    const sim = await call("GET", "/rates/resolve", { query: { nodeId: node, staffId: staff, date: "2026-01-15" } });
    expect(payrollResolvedRateDtoSchema.safeParse(sim.json).success).toBe(true);
    expect(sim.json).toMatchObject({ rate: 9000, origin: "NODE_GENERIC", configState: "ACTIVE" });
    // aucun taux publié s'il n'est pas calculable
    const none = await call("GET", "/rates/resolve", { query: { staffId: newId(), date: "2026-01-15" } });
    expect(none.json).toMatchObject({ rate: null, origin: null, configState: "ABSENT" });
    expect((await call("DELETE", `/rates/${rate.json.id}`)).status).toBe(204);
  });

  it("validation Zod : montants non entiers, dates invalides, corps inconnu, identifiants mal formés → 400 normalisé", async () => {
    const staff = addStaff(w, "Invalide");
    const decimal = await call("POST", "/configs", { body: { staffId: staff, type: "SALARY", monthlySalary: 100.5, effectiveFrom: "2026-01-01" } });
    expect(decimal.status).toBe(400);
    expect(decimal.json).toMatchObject({ kind: "validation" });
    expect((await call("POST", "/configs", { body: { staffId: staff, type: "HOURLY", defaultHourlyRate: -1, effectiveFrom: "2026-01-01" } })).status).toBe(400);
    expect((await call("POST", "/configs", { body: { staffId: staff, type: "HOURLY", effectiveFrom: "01/01/2026" } })).status).toBe(400);
    expect((await call("POST", "/configs", { body: { staffId: staff, type: "HOURLY", effectiveFrom: "2026-01-01", surprise: true } })).status).toBe(400);
    expect((await call("POST", "/configs", { body: { staffId: staff, type: "SALARY", effectiveFrom: "2026-01-01" } })).status).toBe(400); // salariale sans salaire
    expect((await call("GET", "/payslips/pas-un-uuid")).status).toBe(400);
    expect((await call("POST", "/periods", { body: { name: "", startDate: "2026-01-01", endDate: "2026-01-31", academicYearId: newId() } })).status).toBe(400);
    expect((await call("POST", "/periods", { body: { name: "X", startDate: "2026-02-01", endDate: "2026-01-31", academicYearId: newId() } })).status).toBe(400);
    expect((await call("POST", `/payslips/${slipCalc}/cancel`, { body: { reason: "x" } })).status).toBe(400);
  });

  it("bulletins : liste, détail (lignes, ajustements, journal), données figées, conformes aux contrats", async () => {
    const list = await call("GET", "/payslips", { query: { periodId } });
    expect(payrollPayslipPageDtoSchema.safeParse(list.json).success).toBe(true);
    expect(list.json.total).toBe(2);
    const detail = await call("GET", `/payslips/${slipPaid}`);
    expect(payrollPayslipDetailDtoSchema.safeParse(detail.json).success).toBe(true);
    expect(detail.json.payslip).toMatchObject({ status: "PAID", statusLabel: "Payé", staffName: "Awa Titulaire", totalAmount: 30_000, paymentMethod: "CASH" });
    expect(detail.json.events.map((e: { action: string }) => e.action).slice(0, 3)).toEqual(["CALCULATED", "APPROVED", "PAID"]);
    // le titulaire ne voit PAS le journal interne
    const own = await call("GET", `/payslips/${slipPaid}`, { user: teacherUser, perms: TEACHER });
    expect(own.json.events).toEqual([]);
    const data = await call("GET", `/payslips/${slipPaid}/data`);
    expect(payrollPayslipDataDtoSchema.safeParse(data.json).success).toBe(true);
    expect(data.json).toMatchObject({ final: true, watermark: null, intact: true, payment: { method: "CASH" } });
    expect(data.json.document.staff).toMatchObject({ displayName: "Awa Titulaire", matricule: "T-001" });
    // un statut APPROVED non payé : filigrane
    const approved = await call("GET", `/payslips/${slipOtherApproved}/data`);
    expect(approved.json).toMatchObject({ final: true, watermark: "NON VERSÉ", payment: null });
    // filtre de statut
    const paid = await call("GET", "/payslips", { query: { status: "PAID" } });
    expect(paid.json.items.every((i: { status: string }) => i.status === "PAID")).toBe(true);
  });

  it("actions : arrêt par sélection, tout approuver côté serveur, liste vide refusée (400), contestation, annulation, ajustements, notification", async () => {
    const staff = addStaff(w, "Cycle Http", { userId: newId() });
    await addConfig(w, { staffId: staff });
    await db.admin.query("UPDATE payroll.pay_periods SET awaiting_calculation=false WHERE tenant_id=$1", [w.tenantId]);
    const p = await call("POST", "/periods", { body: { name: "Mars", startDate: "2026-03-02", endDate: "2026-03-31", academicYearId: w.yearId } });
    expect(p.status).toBe(201);
    expect(payrollPeriodDtoSchema.safeParse(p.json).success).toBe(true);
    expect(p.json).toMatchObject({ status: "DRAFT", awaitingCalculation: true, targeted: false });
    // une seconde période tant que la première est en attente : 409
    const blocked = await call("POST", "/periods", { body: { name: "Avril", startDate: "2026-04-01", endDate: "2026-04-30", academicYearId: w.yearId } });
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("payroll.period_pending");
    expect((await call("GET", "/periods/pending")).json.pending.id).toBe(p.json.id);

    w.mem.sessions.add(session(staff, "2026-03-03", 60));
    w.mem.attendance.add(attendance(staff, "2026-03-04", 60));
    // aperçu
    const preview = await call("POST", `/periods/${p.json.id}/calculate`, { body: { dryRun: true, staffIds: [staff] } });
    expect(preview.status).toBe(200);
    expect(payrollCalculationReportDtoSchema.safeParse(preview.json).success).toBe(true);
    expect(preview.json.items[0].preview.total).toBe(20_000);
    expect((await call("GET", "/payslips", { query: { periodId: p.json.id } })).json.total).toBe(0);
    // calcul réel, sans la source « présences » : une seule heure lue
    features.delete("payroll.attendance-source");
    const calc = await call("POST", `/periods/${p.json.id}/calculate`, { body: { staffIds: [staff] } });
    features.add("payroll.attendance-source");
    expect(calc.status).toBe(200);
    expect(calc.json).toMatchObject({ calculated: 1, dryRun: false });
    expect(calc.json.items[0].total).toBe(10_000);
    const run = await call("GET", `/runs/${calc.json.runId}`);
    expect(payrollRunDtoSchema.safeParse(run.json).success).toBe(true);
    expect(run.json).toMatchObject({ status: "COMPLETED" });
    const payslipId = calc.json.items[0].payslipId as string;

    // ajustements : PATCH, puis recalcul qui les conserve
    const adj = await call("PATCH", `/payslips/${payslipId}/adjustments`, { body: { add: [{ kind: "BONUS", amount: 2500, label: "Prime" }] } });
    expect(adj.status).toBe(200);
    expect(payrollPayslipDtoSchema.safeParse(adj.json).success).toBe(true);
    expect(adj.json).toMatchObject({ bonusAmount: 2500, totalAmount: 12_500, staffName: "Cycle Http" });
    const re = await call("POST", `/periods/${p.json.id}/calculate`, { body: { staffIds: [staff], recalculate: true } });
    expect(re.json.items[0].total).toBe(20_000 + 2500); // présences réactivées : 2 h ; prime conservée

    // arrêt : liste vide -> 400 ; sélection explicite ; idempotence
    const empty = await call("POST", "/payslips/approve", { body: { payslipIds: [] } });
    expect(empty.status).toBe(400);
    expect(empty.json.code).toBe("payroll.empty_selection");
    const appr = await call("POST", "/payslips/approve", { body: { payslipIds: [payslipId] } });
    expect(appr.status).toBe(200);
    expect(payrollBatchResultDtoSchema.safeParse(appr.json).success).toBe(true);
    expect(appr.json).toMatchObject({ done: [payslipId], unchanged: [], rejected: [] });
    expect((await call("POST", "/payslips/approve", { body: { payslipIds: [payslipId] } })).json.unchanged).toEqual([payslipId]);
    // propriétaire : même action métier
    expect((await call("POST", `/owner/payslips/${payslipId}/validate`, { perms: OWNER })).json.unchanged).toEqual([payslipId]);
    // contestation → ré-arrêt → versement → plus d'annulation
    expect((await call("POST", `/payslips/${payslipId}/dispute`, { body: { reason: "Heures à vérifier" } })).json.status).toBe("DISPUTED");
    expect((await call("POST", "/payslips/approve", { body: { payslipIds: [payslipId] } })).json.done).toEqual([payslipId]);
    const pay = await call("POST", "/payslips/pay", { body: { all: true, periodId: p.json.id, method: "MOBILE_MONEY", reference: "OM-1" } });
    expect(pay.json.done).toEqual([payslipId]);
    const cancel = await call("POST", `/payslips/${payslipId}/cancel`, { body: { reason: "Annulation tardive" } });
    expect(cancel.status).toBe(409);
    expect(cancel.json.code).toBe("payroll.invalid_transition");
    // notification
    expect((await call("POST", `/payslips/${payslipId}/notify`)).status).toBe(202);
  });

  it("masse salariale (propriétaire) : par période et statut ; annulés et contestés exclus du total mais montrés à part", async () => {
    const r = await call("GET", "/owner/mass", { perms: OWNER });
    expect(r.status).toBe(200);
    expect(payrollOwnerMassDtoSchema.safeParse(r.json).success).toBe(true);
    const first = (r.json.periods as Array<{ periodId: string; counted: { payslips: number; total: number }; byStatus: Record<string, { total: number }>; apart: any }>).find((x) => x.periodId === periodId);
    expect(first).toBeDefined();
    const statusTotals = Object.entries(first?.byStatus ?? {});
    const counted = statusTotals.filter(([k]) => !["CANCELLED", "DISPUTED"].includes(k)).reduce((s, [, v]) => s + v.total, 0);
    expect(first?.counted.total).toBe(counted);
    expect(r.json.counted.total).toBe((r.json.periods as Array<{ counted: { total: number } }>).reduce((s, p) => s + p.counted.total, 0));
  });

  it("rapports : ventilation à trois postes (Σ présences + Σ séances + hors-heures = total) avec le filtre d'origine", async () => {
    const all = await call("GET", "/reports/summary", { query: {} });
    expect(payrollSummaryDtoSchema.safeParse(all.json).success).toBe(true);
    for (const row of all.json.rows as Array<{ attendance: number; session: number; outOfHours: number; total: number }>) {
      expect(row.attendance + row.session + row.outOfHours).toBe(row.total);
    }
    const sessionOnly = await call("GET", "/reports/summary", { query: { source: "SESSION" } });
    const attendanceOnly = await call("GET", "/reports/summary", { query: { source: "ATTENDANCE" } });
    for (const [i, row] of (sessionOnly.json.rows as Array<{ session: number; filtered: number }>).entries()) expect(row.filtered).toBe(row.session);
    for (const row of attendanceOnly.json.rows as Array<{ attendance: number; filtered: number }>) expect(row.filtered).toBe(row.attendance);
  });

  it("export CSV : colonnes de l'écran, formules neutralisées, auditée ; réservée à qui lit les rapports / bulletins", async () => {
    const evil = addStaff(w, "=HYPERLINK(\"http://x\")");
    await addConfig(w, { staffId: evil });
    await db.admin.query("UPDATE payroll.pay_periods SET awaiting_calculation=false WHERE tenant_id=$1", [w.tenantId]);
    const p = await addPeriod(w, { startDate: "2026-04-01", endDate: "2026-04-30" });
    w.mem.sessions.add(session(evil, "2026-04-02", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id }));
    const [slip] = await payslipRows(w, "period_id=$2 AND staff_id=$3", [p.id, evil]);
    await call("POST", "/payslips/approve", { body: { payslipIds: [slip?.id] } });
    const before = w.audit.actions().length;
    const res = await call("GET", "/history/export", { query: { periodId: p.id } });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toContain("Montant présences");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=HYPERLINK"); // jamais interprétée comme formule
    expect(lines[1]).toContain("Impayé");
    expect(w.audit.actions().slice(before)).toContain("payroll.export.generated");
    expect((await call("GET", "/history/export", { perms: TEACHER, user: teacherUser })).status).toBe(403);
    const filtered = await call("GET", "/reports/export", { query: { periodId: p.id, source: "ATTENDANCE" } });
    expect(filtered.text.replace(/^﻿/, "").trim().split("\r\n")).toHaveLength(1); // aucune ligne d'origine « présences »
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslips WHERE tenant_id=$1", [w.tenantId])).length).toBeGreaterThan(3);
  });
});
