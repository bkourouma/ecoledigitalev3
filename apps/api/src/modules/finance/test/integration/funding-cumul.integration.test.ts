/**
 * O-04 : cumul de financements sur une inscription (bourse + État + famille), facturation cohérente (Postgres réel).
 *
 * Une facture par financeur (une par prise en charge) + une facture famille ; la somme des parts est contrôlée (module ET base) ;
 * le comportement historique (un seul type principal, parts séquentielles `REMAINING`) est inchangé ; isolation A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, newId, unwrap } from "@ecoledigitale/kernel";
import { changeScholarshipStatus, createScholarship, getLearnerFunding, setLearnerFunding } from "../../application/catalog";
import { issueInvoiceFromSchedule } from "../../application/invoices";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, nextKey, seedCatalog, YEAR } from "../support/scenario";

describeIntegration("cumul de financements : bourse + État + famille (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(16);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
  });
  afterAll(async () => {
    await db.drop();
  });

  const share = (learner: string, funderKind: "STATE" | "FOUNDATION" | "COMPANY", bps: number, extra: Record<string, unknown> = {}) =>
    createScholarship(world.deps, ctx, {
      learnerId: learner,
      academicYear: YEAR,
      funderKind,
      funderName: funderKind === "STATE" ? "État de Côte d'Ivoire" : "Fondation Espoir",
      coverage: { kind: "PERCENT", bps },
      shareBasis: "TOTAL",
      priority: funderKind === "STATE" ? 1 : 2,
      ...extra,
    });
  const bill = (learner: string) => issueInvoiceFromSchedule(world.deps, ctx, { learnerId: learner, academicYear: YEAR, items: [{ feeCode: "SCOL" }, { feeCode: "CANT" }], idempotencyKey: nextKey("cumul") });

  it("État 60 % + bourse 25 % + famille 15 % : trois factures liées, somme au franc près, chaque financeur facturé pour SA part", async () => {
    const learner = learnerId();
    unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2026-0100", additionalFundingTypes: ["SCHOLARSHIP"] }));
    const state = unwrap(await share(learner, "STATE", 6000, { reference: "AFF-2026-0100" }));
    const foundation = unwrap(await share(learner, "FOUNDATION", 2500));
    const result = unwrap(await bill(learner));
    expect(result.invoices).toHaveLength(3);
    const byPayer = new Map(result.invoices.map((i) => [i.invoice.payerRef ?? "FAMILLE", i.invoice]));
    expect(byPayer.get(state.id)!.total.amount).toBe(336_000);
    expect(byPayer.get(foundation.id)!.total.amount).toBe(140_000);
    expect(byPayer.get("FAMILLE")!.total.amount).toBe(84_000);
    expect(result.invoices.reduce((s, i) => s + i.invoice.total.amount, 0)).toBe(560_000);
    expect(new Set(result.invoices.map((i) => i.invoice.relatedGroupId)).size).toBe(1);
    // Compatibilité arrière : le type principal historique reste lu ; le cumul s'y ajoute.
    const funding = unwrap(await getLearnerFunding(world.deps, ctx, learner));
    expect(funding.account).toMatchObject({ fundingType: "STATE_ASSIGNED", additionalFundingTypes: ["SCHOLARSHIP"] });
    expect(funding.scholarships.map((s) => s.shareBasis)).toEqual(["TOTAL", "TOTAL"]);
    expect(byPayer.get("FAMILLE")!.fundingType).toBe("STATE_ASSIGNED");
  });

  it("non-régression : sans base TOTAL, l'État (60 %) puis la bourse (25 % du RESTE) se calculent comme avant", async () => {
    const learner = learnerId();
    unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2026-0101" }));
    const state = unwrap(await createScholarship(world.deps, ctx, { learnerId: learner, academicYear: YEAR, funderKind: "STATE", funderName: "État", coverage: { kind: "PERCENT", bps: 6000 }, priority: 1 }));
    const foundation = unwrap(await createScholarship(world.deps, ctx, { learnerId: learner, academicYear: YEAR, funderKind: "FOUNDATION", funderName: "Fondation", coverage: { kind: "PERCENT", bps: 2500 }, priority: 2 }));
    expect(state.shareBasis).toBe("REMAINING");
    const result = unwrap(await bill(learner));
    const totals = new Map(result.invoices.map((i) => [i.invoice.payerRef ?? "FAMILLE", i.invoice.total.amount]));
    expect(totals.get(state.id)).toBe(336_000);
    expect(totals.get(foundation.id)).toBe(56_000);
    expect(totals.get("FAMILLE")).toBe(168_000);
  });

  it("somme des parts > 100 % : refusée par le module ET par la base (superutilisateur compris)", async () => {
    const learner = learnerId();
    unwrap(await share(learner, "STATE", 6000));
    unwrap(await share(learner, "FOUNDATION", 4000)); // 100 % exact : accepté
    const over = await share(learner, "COMPANY", 1);
    expect(!over.ok && over.error.code).toBe("finance.funding_shares_exceed");
    await expect(
      db.admin.query(
        `INSERT INTO finance.scholarships (id, tenant_id, learner_id, academic_year, funder_kind, funder_name, coverage_kind, coverage_bps, currency, share_basis)
         VALUES ($1,$2,$3,$4,'COMPANY','Entreprise','PERCENT',1,'XOF','TOTAL')`,
        [newId(), tenantId, learner, YEAR],
      ),
    ).rejects.toThrow(/finance\.funding_shares_exceed/);
    // Des parts REMAINING (historiques) ne sont pas concernées par le contrôle de somme.
    unwrap(await createScholarship(world.deps, ctx, { learnerId: learner, academicYear: YEAR, funderKind: "COMPANY", funderName: "Entreprise", coverage: { kind: "PERCENT", bps: 5000 } }));
    // Autre année : somme indépendante.
    unwrap(await createScholarship(world.deps, ctx, { learnerId: learner, academicYear: "2026-2027", funderKind: "STATE", funderName: "État", coverage: { kind: "PERCENT", bps: 9000 }, shareBasis: "TOTAL" }));
  });

  it("réactiver une part qui ferait dépasser 100 % est refusé (409), pas une erreur 500", async () => {
    const learner = learnerId();
    const a = unwrap(await share(learner, "STATE", 7000));
    unwrap(await changeScholarshipStatus(world.deps, ctx, { scholarshipId: a.id, status: "SUSPENDED" }));
    unwrap(await share(learner, "FOUNDATION", 6000));
    const back = await changeScholarshipStatus(world.deps, ctx, { scholarshipId: a.id, status: "ACTIVE" });
    expect(!back.ok && back.error.code).toBe("finance.funding_shares_exceed");
  });

  it("une part en montant que le total à facturer ne couvre pas : l'émission est refusée, rien n'est écrit", async () => {
    const learner = learnerId();
    unwrap(await share(learner, "STATE", 6000));
    unwrap(
      await createScholarship(world.deps, ctx, {
        learnerId: learner, academicYear: YEAR, funderKind: "COMPANY", funderName: "Entreprise", coverage: { kind: "FIXED", amount: Money.of(400_000, "XOF") },
        shareBasis: "TOTAL", priority: 2,
      }),
    );
    const refused = await bill(learner);
    expect(!refused.ok && refused.error.code).toBe("finance.funding_shares_exceed");
    expect(await adminRows(db, "SELECT 1 FROM finance.invoices WHERE tenant_id = $1 AND learner_id = $2", [tenantId, learner])).toHaveLength(0);
  });

  it("chaque type du cumul doit être soutenu : cumul « boursier » sans bourse active refusé à l'émission", async () => {
    const learner = learnerId();
    unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2026-0102", additionalFundingTypes: ["SCHOLARSHIP"] }));
    unwrap(await share(learner, "STATE", 6000));
    const refused = await bill(learner);
    expect(!refused.ok && refused.error.code).toBe("finance.funding_assignment_missing");
    unwrap(await share(learner, "FOUNDATION", 2000));
    expect((await bill(learner)).ok).toBe(true);
  });

  it("l'ancienne route (type principal seul) conserve le cumul ; null l'efface ; « privé » n'est pas cumulable", async () => {
    const learner = learnerId();
    unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "A", additionalFundingTypes: ["COMPANY", "SCHOLARSHIP"] }));
    const kept = unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "B" }));
    expect(kept.additionalFundingTypes).toEqual(["COMPANY", "SCHOLARSHIP"]);
    const promoted = unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "COMPANY" }));
    expect(promoted.additionalFundingTypes).toEqual(["SCHOLARSHIP"]);
    const cleared = unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "COMPANY", additionalFundingTypes: null }));
    expect(cleared.additionalFundingTypes).toEqual([]);
    const priv = await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "COMPANY", additionalFundingTypes: ["PRIVATE"] });
    expect(priv.ok).toBe(false);
  });

  it("isolation A/B : les parts et le cumul d'un établissement sont invisibles pour l'autre, qui a ses propres 100 %", async () => {
    const learner = learnerId();
    unwrap(await setLearnerFunding(world.deps, ctx, { learnerId: learner, fundingType: "STATE_ASSIGNED", assignmentRef: "A", additionalFundingTypes: ["SCHOLARSHIP"] }));
    unwrap(await share(learner, "STATE", 10_000));
    const tenantB = await db.createTenant();
    const b = ctxFor(tenantB);
    const seen = unwrap(await getLearnerFunding(world.deps, b, learner));
    expect(seen.scholarships).toEqual([]);
    expect(seen.account).toMatchObject({ fundingType: "PRIVATE", additionalFundingTypes: [] });
    unwrap(await createScholarship(world.deps, b, { learnerId: learner, academicYear: YEAR, funderKind: "FOUNDATION", funderName: "Fondation B", coverage: { kind: "PERCENT", bps: 10_000 }, shareBasis: "TOTAL" }));
    expect(await db.tenantDb.run(b, (tx) => tx.many("SELECT id FROM finance.scholarships WHERE tenant_id = $1", [tenantId]))).toEqual([]);
  });
});
