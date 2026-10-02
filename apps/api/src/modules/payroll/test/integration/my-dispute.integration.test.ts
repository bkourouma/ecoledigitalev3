/**
 * Contestation de SON PROPRE bulletin par l'enseignant : `POST /api/v1/payroll/my/payslips/:id/dispute`
 * (permission `payroll.my.dispute`, SANS `payroll.payslip.approve`).
 *
 * Matrice : titulaire OK ; autre enseignant 404 ; sans permission 403 ; états interdits 409 (payé, déjà contesté) ;
 * brouillon calculé / annulé 404 (le titulaire ne peut pas les lire) ; motif vide 400 ; compte sans fiche 403 ;
 * isolation inter-tenants ; audit, journal du bulletin et événement présents ; la route de la gestion reste inchangée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId } from "@ecoledigitale/kernel";
import { payrollMyDisputeBodySchema, payrollPayslipDtoSchema } from "@ecoledigitale/contracts/src/v2/payroll";
import manifest from "../../manifest";
import { payrollPlugin } from "../../http/plugin";
import { calculatePeriod } from "../../application/calculate";
import { approvePayslips, cancelPayslip, payPayslips } from "../../application/workflow";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addStaff, createWorld, payslipRows, releasePending, session, unwrap, type World } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);
const MANAGER = ALL.filter((p) => p !== "payroll.payslip.read_own" && p !== "payroll.payslip.approve_owner" && p !== "payroll.my.dispute");
const TEACHER = ["payroll.payslip.read_own", "payroll.my.dispute"];
const READ_ONLY_TEACHER = ["payroll.payslip.read_own"];

describeIntegration("POST /my/payslips/:id/dispute (Postgres réel)", () => {
  let db: PayrollTestDb;
  let w: World;
  let other: World;
  let app: FastifyInstance;
  const features = new Set(["payroll.core", "payroll.owner-validation", "payroll.session-source", "payroll.attendance-source"]);
  const manager = newId();
  const awaUser = newId();
  const bobUser = newId();
  const ghostUser = newId(); // compte sans fiche du personnel
  let awa: string;
  let bob: string;
  let period: string;
  /** Bulletins d'Awa, un par état. */
  const awaSlip = {} as Record<"approved" | "second" | "third" | "fourth" | "paid" | "calculated" | "cancelled" | "managerApproved", string>;
  let bobSlip: string;
  let otherSlip: string;

  beforeAll(async () => {
    db = await createPayrollTestDb(24);
    w = await createWorld({ db });
    other = await createWorld({ db });
    awa = addStaff(w, "Awa Titulaire", { userId: awaUser });
    bob = addStaff(w, "Bob Autre", { userId: bobUser });
    await addConfig(w, { staffId: awa });
    await addConfig(w, { staffId: bob });

    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: typeof user === "string" ? user : newId(), roles: [] });
    });
    await app.register(payrollPlugin, {
      deps: w.deps,
      prefix: "/api/v1/payroll",
      requirePermission: (permission) => async (req) => {
        if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
        if (!String(req.headers["x-test-perms"] ?? "").split(",").includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      requireFeature: (feature) => async (_req, reply) => {
        if (!features.has(feature)) return reply.status(403).send({ status: 403, code: "entitlements.feature_not_available" });
        return undefined;
      },
      isFeatureEnabled: async (_ctx, feature) => features.has(feature),
    });
    await app.ready();

    // Trois périodes successives pour disposer de bulletins d'Awa dans chaque état (une heure ne se paie qu'une fois)
    const slips: string[] = [];
    const dates = ["2026-01-06", "2026-02-03", "2026-03-03", "2026-04-07", "2026-05-05", "2026-06-02", "2026-07-07", "2026-08-04"];
    for (const [i, d] of dates.entries()) {
      await releasePending(w);
      const month = d.slice(0, 7);
      const p = await addPeriod(w, { name: `Période ${month}`, startDate: `${month}-01`, endDate: `${month}-28` });
      if (i === 0) period = p.id;
      w.mem.sessions.add(session(awa, d, 120));
      if (i === 0) w.mem.sessions.add(session(bob, d, 60));
      unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id }));
      slips.push((await payslipRows(w, "period_id=$2 AND staff_id=$3", [p.id, awa]))[0]?.id as string);
    }
    (["approved", "second", "third", "fourth", "paid", "calculated", "cancelled", "managerApproved"] as const).forEach((k, i) => {
      awaSlip[k] = slips[i] as string;
    });
    bobSlip = (await payslipRows(w, "period_id=$2 AND staff_id=$3", [period, bob]))[0]?.id as string;

    const approve = (ids: string[]) => approvePayslips(w.deps, w.ctxOf(manager), { selection: { payslipIds: ids }, caps: { ownerApproval: true } });
    unwrap(await approve([awaSlip.approved, awaSlip.second, awaSlip.third, awaSlip.fourth, awaSlip.paid, awaSlip.cancelled, awaSlip.managerApproved, bobSlip]));
    unwrap(await payPayslips(w.deps, w.ctxOf(manager), { selection: { payslipIds: [awaSlip.paid] }, method: "CASH" }));
    unwrap(await cancelPayslip(w.deps, w.ctxOf(manager), { payslipId: awaSlip.cancelled, reason: "Erreur de saisie" }));

    // autre tenant : un bulletin approuvé de SON enseignant (autre monde, mêmes ports ignorés : la RLS isole)
    const x = addStaff(other, "Xavier Ailleurs", { userId: newId() });
    await addConfig(other, { staffId: x });
    const op = await addPeriod(other);
    other.mem.sessions.add(session(x, "2026-01-06", 60));
    unwrap(await calculatePeriod(other.deps, other.ctxOf(), { periodId: op.id }));
    otherSlip = (await payslipRows(other))[0]?.id as string;
    unwrap(await approvePayslips(other.deps, other.ctxOf(manager), { selection: { payslipIds: [otherSlip] }, caps: { ownerApproval: true } }));
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  async function dispute(id: string, o: { user?: string; perms?: string[]; body?: unknown; tenant?: string; route?: "my" | "manager" } = {}) {
    const headers: Record<string, string> = { "x-test-tenant": o.tenant ?? w.tenantId, "x-test-user": o.user ?? awaUser, "x-test-perms": (o.perms ?? TEACHER).join(","), "content-type": "application/json" };
    const url = o.route === "manager" ? `/api/v1/payroll/payslips/${id}/dispute` : `/api/v1/payroll/my/payslips/${id}/dispute`;
    const res = await app.inject({ method: "POST", url, headers, payload: JSON.stringify(o.body ?? { reason: "Il manque deux heures de cours" }) });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  }
  const statusOf = async (id: string) => (await adminRows<{ status: string }>(db, "SELECT status FROM payroll.payslips WHERE id=$1", [id]))[0]?.status;

  it("le titulaire conteste son bulletin arrêté : 200, DISPUTED, motif conservé, réponse conforme au contrat", async () => {
    const r = await dispute(awaSlip.approved, { body: { reason: "  Il manque deux heures de cours  " } });
    expect(r.status).toBe(200);
    expect(payrollPayslipDtoSchema.safeParse(r.json).success).toBe(true);
    expect(r.json).toMatchObject({ id: awaSlip.approved, status: "DISPUTED", disputeReason: "Il manque deux heures de cours", staffName: "Awa Titulaire" });
    expect(await statusOf(awaSlip.approved)).toBe("DISPUTED");
  });

  it("trace complète : audit (sensible, motif, initiatedBy HOLDER), journal du bulletin au nom du titulaire, événement outbox", async () => {
    const before = w.audit.entries.length;
    const r = await dispute(awaSlip.second, { body: { reason: "Montant incohérent avec mes heures" } });
    expect(r.status).toBe(200);
    const audits = w.audit.entries.slice(before).filter((e) => e.entry.action === "payroll.payslip.disputed");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.ctx.userId).toBe(awaUser);
    expect(audits[0]?.entry).toMatchObject({ resourceType: "payslip", resourceId: awaSlip.second, sensitive: true, reason: "Montant incohérent avec mes heures", before: { status: "APPROVED" }, after: { status: "DISPUTED", initiatedBy: "HOLDER" } });

    const journal = await adminRows<{ action: string; reason: string; actor_id: string; new_values: any }>(db, "SELECT action, reason, actor_id, new_values FROM payroll.payslip_events WHERE payslip_id=$1 AND action='DISPUTED'", [awaSlip.second]);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ reason: "Montant incohérent avec mes heures", actor_id: awaUser, new_values: { status: "DISPUTED", initiatedBy: "HOLDER" } });

    const events = await adminRows<{ payload: any; type: string }>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.disputed' AND payload->>'payslipId'=$2", [w.tenantId, awaSlip.second]);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ v: 1, payslipId: awaSlip.second, staffId: awa, reason: "Montant incohérent avec mes heures", initiatedBy: "HOLDER" });
  });

  it("double contestation : la seconde est refusée en 409 (payroll.invalid_transition), un seul événement et une seule trace", async () => {
    expect((await dispute(awaSlip.third)).status).toBe(200);
    const again = await dispute(awaSlip.third);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("payroll.invalid_transition");
    const events = await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type='payroll.payslip.disputed' AND payload->>'payslipId'=$1", [awaSlip.third]);
    expect(events).toHaveLength(1);
    const journal = await adminRows(db, "SELECT 1 FROM payroll.payslip_events WHERE payslip_id=$1 AND action='DISPUTED'", [awaSlip.third]);
    expect(journal).toHaveLength(1);
  });

  it("bulletin d'un autre enseignant : 404 uniforme, indiscernable d'un identifiant inconnu ; rien n'est modifié", async () => {
    const theirs = await dispute(bobSlip);
    const unknown = await dispute(newId());
    expect(theirs.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(theirs.json.code).toBe(unknown.json.code);
    expect(theirs.json.kind).toBe(unknown.json.kind);
    const noId = (m: string) => m.replace(/\([0-9a-f-]{36}\)/, "(ID)");
    expect(noId(theirs.json.message)).toBe(noId(unknown.json.message)); // même message, hors l'identifiant demandé
    expect(await statusOf(bobSlip)).toBe("APPROVED");
    // et l'inverse : Bob ne peut pas contester le bulletin d'Awa
    expect((await dispute(awaSlip.fourth, { user: bobUser })).status).toBe(404);
    expect(await statusOf(awaSlip.fourth)).toBe("APPROVED");
  });

  it("sans la permission : 403 (même avec la lecture de ses bulletins) ; sans contexte : 401 ; la gestion n'a pas besoin de cette permission", async () => {
    expect((await dispute(awaSlip.fourth, { perms: READ_ONLY_TEACHER })).status).toBe(403);
    expect((await dispute(awaSlip.fourth, { perms: [] })).status).toBe(403);
    const res = await app.inject({ method: "POST", url: `/api/v1/payroll/my/payslips/${awaSlip.fourth}/dispute`, headers: { "content-type": "application/json" }, payload: JSON.stringify({ reason: "Motif valable" }) });
    expect(res.statusCode).toBe(401);
    // `payroll.payslip.approve` n'ouvre PAS cette route (elle est réservée au titulaire)
    expect((await dispute(awaSlip.fourth, { perms: MANAGER })).status).toBe(403);
    expect(await statusOf(awaSlip.fourth)).toBe("APPROVED");
  });

  it("un compte qui n'est lié à aucun membre du personnel : 403 ; un compte de gestion non titulaire reçoit 404 même avec la permission", async () => {
    const ghost = await dispute(awaSlip.fourth, { user: ghostUser });
    expect(ghost.status).toBe(403);
    // gestionnaire auquel on aurait accordé `payroll.my.dispute` : il n'est le titulaire d'aucun bulletin
    w.mem.staff.add({ staffId: newId(), displayName: "Gestionnaire", matricule: "G-1", active: true, userId: manager });
    expect((await dispute(awaSlip.fourth, { user: manager })).status).toBe(404);
    expect(await statusOf(awaSlip.fourth)).toBe("APPROVED");
  });

  it("états interdits : payé → 409 ; brouillon calculé et bulletin annulé → 404 (le titulaire ne peut pas les lire)", async () => {
    const paid = await dispute(awaSlip.paid);
    expect(paid.status).toBe(409);
    expect(paid.json.code).toBe("payroll.invalid_transition");
    expect(await statusOf(awaSlip.paid)).toBe("PAID");
    expect((await dispute(awaSlip.calculated)).status).toBe(404);
    expect(await statusOf(awaSlip.calculated)).toBe("CALCULATED");
    expect((await dispute(awaSlip.cancelled)).status).toBe(404);
    expect(await statusOf(awaSlip.cancelled)).toBe("CANCELLED");
  });

  it("motif obligatoire : vide, blanc, trop court, absent, trop long, champ inconnu → 400 ; le bulletin ne bouge pas", async () => {
    for (const body of [{ reason: "" }, { reason: "     " }, { reason: "ab" }, {}, { reason: "x".repeat(501) }, { reason: "Motif valable", payslipId: newId() }, { reason: 42 }]) {
      const r = await dispute(awaSlip.managerApproved, { body });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(await statusOf(awaSlip.managerApproved)).toBe("APPROVED");
    expect(payrollMyDisputeBodySchema.safeParse({ reason: "" }).success).toBe(false);
    expect(payrollMyDisputeBodySchema.safeParse({ reason: "  ok  " }).success).toBe(false);
    expect(payrollMyDisputeBodySchema.safeParse({ reason: " Motif " }).success).toBe(true);
  });

  it("identifiant mal formé : 400", async () => {
    expect((await dispute("pas-un-uuid")).status).toBe(400);
  });

  it("isolation inter-tenants : le bulletin d'un autre tenant est invisible (404), même pour un titulaire homonyme", async () => {
    const r = await dispute(otherSlip); // contexte du tenant `w`
    expect(r.status).toBe(404);
    expect(await statusOf(otherSlip)).toBe("APPROVED");
    // le contexte du tenant B avec l'identifiant de A : l'annuaire de A ne résout pas ce compte → 403/404, jamais 200
    const cross = await dispute(awaSlip.fourth, { tenant: other.tenantId });
    expect([403, 404]).toContain(cross.status);
    expect(await statusOf(awaSlip.fourth)).toBe("APPROVED");
    expect(await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.disputed'", [other.tenantId])).toHaveLength(0);
  });

  it("la route de la gestion est inchangée : permission approve requise, bulletin d'autrui contestable par la gestion, initiatedBy MANAGER", async () => {
    expect((await dispute(awaSlip.managerApproved, { route: "manager", perms: TEACHER })).status).toBe(403);
    const r = await dispute(awaSlip.managerApproved, { route: "manager", user: manager, perms: MANAGER, body: { reason: "Contrôle de la direction" } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("DISPUTED");
    const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE type='payroll.payslip.disputed' AND payload->>'payslipId'=$1", [awaSlip.managerApproved]);
    expect(ev[0]?.payload).toMatchObject({ initiatedBy: "MANAGER" });
  });

  it("après contestation, le titulaire voit son bulletin DISPUTED et la gestion peut le ré-arrêter", async () => {
    expect(await statusOf(awaSlip.approved)).toBe("DISPUTED");
    const re = unwrap(await approvePayslips(w.deps, w.ctxOf(manager), { selection: { payslipIds: [awaSlip.approved] }, caps: { ownerApproval: true } }));
    expect(re.done).toEqual([awaSlip.approved]);
    expect(await statusOf(awaSlip.approved)).toBe("APPROVED");
    // il peut contester de nouveau après le ré-arrêt
    expect((await dispute(awaSlip.approved, { body: { reason: "Toujours incorrect" } })).status).toBe(200);
  });
});
