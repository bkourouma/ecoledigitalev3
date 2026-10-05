/**
 * O-04 : cumul de financements sur une inscription (bourse + État + famille), avec une part par financement.
 * Postgres réel : la somme des parts est imposée par la base, l'historique est conservé, le type principal historique reste lu,
 * isolation A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { changeEnrollmentFunding, enrollStudent, getEnrollmentHistory, listEnrollmentFundings, setEnrollmentFundings, upsertEnrollmentFundingShare } from "../../index";
import { adminRows, createAcademicTestDb, ctxFor, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, assertEventsValid, codeOf, eventsOf, makeWorld, seedHigher, type HigherSeed, type World } from "../support/world";

describeIntegration("cumul de financements d'une inscription (Postgres réel)", () => {
  let db: AcademicTestDb;
  let w: World;
  let s: HigherSeed;
  const sql = (text: string, params: unknown[] = []) => db.admin.query(text, params);

  beforeAll(async () => {
    db = await createAcademicTestDb();
    w = makeWorld(db, await db.createTenant());
    s = await seedHigher(w, { capacity: 30 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const enroll = async () => unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
  const scholarship = (bps: number) => ({ fundingType: "SCHOLARSHIP", share: { kind: "PERCENT", bps } as const, funderLabel: "Fondation Espoir" });
  const state = (bps: number) => ({ fundingType: "STATE_ASSIGNED", share: { kind: "PERCENT", bps } as const, assignmentReference: "AFF-2026-0001", funderLabel: "État" });

  it("bourse 40 % + État 50 % : parts conservées, famille 10 %, principal historique = la plus grande part, historique et événement", async () => {
    const e = await enroll();
    expect(e.fundingType).toBe("PRIVATE");
    const view = unwrap(await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [scholarship(4000), state(5000)], reason: "Cumul bourse + État" }));
    expect(view).toMatchObject({ enrollmentId: e.id, principalFundingType: "STATE_ASSIGNED", familyRemainderBps: 1000 });
    expect(view.fundings.map((f) => [f.fundingType, f.share])).toEqual([["SCHOLARSHIP", { kind: "PERCENT", bps: 4000 }], ["STATE_ASSIGNED", { kind: "PERCENT", bps: 5000 }]]);
    // Compatibilité arrière : l'inscription porte toujours son type principal et sa référence d'affectation.
    const main = (await adminRows<{ funding_type: string; assignment_reference: string | null }>(db, "SELECT funding_type, assignment_reference FROM academic.enrollments WHERE id = $1", [e.id]))[0]!;
    expect(main).toEqual({ funding_type: "STATE_ASSIGNED", assignment_reference: "AFF-2026-0001" });
    const history = unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id)).filter((h) => h.kind === "FUNDING");
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history[0]!.toValue)).toContain("SCHOLARSHIP");
    const ev = (await eventsOf(w, "academic.enrollment.funding_changed")).filter((x) => x.payload.enrollmentId === e.id);
    expect(ev[0]!.payload).toMatchObject({ to: { fundingType: "STATE_ASSIGNED" }, fundings: [{ fundingType: "SCHOLARSHIP", shareKind: "PERCENT", shareBps: 4000 }, { fundingType: "STATE_ASSIGNED", shareBps: 5000 }] });
    await assertEventsValid(w);
    expect(w.audit.entries.some((a) => a.entry.action === "academic.enrollment.fundings_changed" && a.entry.sensitive)).toBe(true);
  });

  it("somme > 100 % refusée par le module ET par la base ; 100 % exact accepté (famille 0 %)", async () => {
    const e = await enroll();
    const over = await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [scholarship(5001), state(5000)], reason: "Trop de parts" });
    expect(codeOf(over)).toBe("academic.funding_shares_exceed");
    expect(unwrap(await listEnrollmentFundings(w.deps, w.ctx, e.id)).fundings).toEqual([]);
    const full = unwrap(await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [scholarship(5000), state(5000)], reason: "Pris en charge à 100 %" }));
    expect(full.familyRemainderBps).toBe(0);
    // Contournement direct en SQL (superutilisateur) : le déclencheur juge.
    await expect(
      sql(`INSERT INTO academic.enrollment_fundings (id, tenant_id, enrollment_id, funding_type, share_kind, share_bps, funder_label) VALUES ($1,$2,$3,'COMPANY','PERCENT',1,'Entreprise X')`, [newId(), w.tenantId, e.id]),
    ).rejects.toThrow(/academic\.funding_shares_exceed/);
  });

  it("parts en montant : même devise exigée ; le reste de la famille n'est connu qu'à la facturation", async () => {
    const e = await enroll();
    const mixed = await setEnrollmentFundings(w.deps, w.ctx, e.id, {
      shares: [
        { fundingType: "COMPANY", share: { kind: "AMOUNT", amount: 100_000, currency: "XOF" }, funderLabel: "Entreprise A" },
        { fundingType: "SCHOLARSHIP", share: { kind: "AMOUNT", amount: 50_000, currency: "EUR" }, funderLabel: "Fondation B" },
      ],
      reason: "Deux devises",
    });
    expect(codeOf(mixed)).toBe("academic.funding_currency_mismatch");
    const ok = unwrap(
      await setEnrollmentFundings(w.deps, w.ctx, e.id, {
        shares: [
          { fundingType: "COMPANY", share: { kind: "AMOUNT", amount: 100_000, currency: "XOF" }, funderLabel: "Entreprise A" },
          { fundingType: "SCHOLARSHIP", share: { kind: "PERCENT", bps: 2500 }, funderLabel: "Fondation B" },
        ],
        reason: "Montant et pourcentage",
      }),
    );
    expect(ok.familyRemainderBps).toBeNull();
    expect(ok.principalFundingType).toBe("SCHOLARSHIP");
    await expect(
      sql(`INSERT INTO academic.enrollment_fundings (id, tenant_id, enrollment_id, funding_type, share_kind, share_amount, currency, funder_label) VALUES ($1,$2,$3,'OTHER','AMOUNT',5,'EUR','Autre')`, [newId(), w.tenantId, e.id]),
    ).rejects.toThrow(/academic\.funding_currency_mismatch/);
  });

  it("remplacement atomique : les anciennes parts sont terminées (jamais supprimées) ; contenu immuable ; cumul vide = famille seule", async () => {
    const e = await enroll();
    unwrap(await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [scholarship(3000)], reason: "Bourse seule" }));
    unwrap(await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [scholarship(6000), state(2000)], reason: "Bourse augmentée + État" }));
    const all = await adminRows<{ status: string; share_bps: number }>(db, "SELECT status, share_bps FROM academic.enrollment_fundings WHERE enrollment_id = $1 ORDER BY created_at, share_bps", [e.id]);
    expect(all.map((r) => [r.status, r.share_bps])).toEqual([["ENDED", 3000], ["ACTIVE", 2000], ["ACTIVE", 6000]]);
    await expect(sql("UPDATE academic.enrollment_fundings SET share_bps = 1 WHERE enrollment_id = $1 AND status = 'ACTIVE'", [e.id])).rejects.toThrow(/academic\.immutable/);
    await expect(sql("UPDATE academic.enrollment_fundings SET notes = 'x' WHERE enrollment_id = $1 AND status = 'ENDED'", [e.id])).rejects.toThrow(/academic\.immutable/);
    await expect(sql("DELETE FROM academic.enrollment_fundings WHERE enrollment_id = $1", [e.id])).rejects.toThrow(/academic\.immutable/);
    const cleared = unwrap(await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [], reason: "Fin de la prise en charge" }));
    expect(cleared).toMatchObject({ principalFundingType: "PRIVATE", familyRemainderBps: 10_000, fundings: [] });
  });

  it("entrées invalides : « privé » n'est pas une part, référence d'affectation exigée, doublon refusé, motif obligatoire", async () => {
    const e = await enroll();
    const call = (shares: any[], reason = "Motif valable") => setEnrollmentFundings(w.deps, w.ctx, e.id, { shares, reason });
    expect(codeOf(await call([{ fundingType: "PRIVATE", share: { kind: "PERCENT", bps: 1000 } }]))).toBe("academic.funding_shares_invalid");
    expect(codeOf(await call([{ fundingType: "STATE_ASSIGNED", share: { kind: "PERCENT", bps: 1000 } }]))).toBe("academic.funding_reference_required");
    expect(codeOf(await call([{ fundingType: "SCHOLARSHIP", share: { kind: "PERCENT", bps: 1000 } }]))).toBe("academic.funding_funder_required");
    expect(codeOf(await call([scholarship(1000), scholarship(2000)]))).toBe("academic.funding_shares_invalid");
    expect(codeOf(await call([{ ...scholarship(0) }]))).toBe("academic.funding_shares_invalid");
    expect(codeOf(await call([scholarship(1000)], "ok"))).toBe("academic.enrollment_reason_required");
  });

  it("ajout d'une part SANS toucher aux autres : principal conservé quand il est déjà non privé, sinon il devient ce type", async () => {
    // Inscription historique : principal « boursier » posé par l'ancienne route (aucune part).
    const legacy = await enroll();
    unwrap(await changeEnrollmentFunding(w.deps, w.ctx, legacy.id, { fundingType: "SCHOLARSHIP", funderLabel: "Fondation Espoir", reason: "Boursier avant le cumul" }));
    expect(unwrap(await listEnrollmentFundings(w.deps, w.ctx, legacy.id))).toMatchObject({ principalFundingType: "SCHOLARSHIP", fundings: [] });
    const added = unwrap(await upsertEnrollmentFundingShare(w.deps, w.ctx, legacy.id, { share: { ...state(0), share: { kind: "AMOUNT", amount: 300_000, currency: "XOF" } }, reason: "Dossier d'affectation vérifié" }));
    expect(added.principalFundingType).toBe("SCHOLARSHIP"); // le cumul ne retire pas le principal historique
    expect(added.fundings.map((f) => f.fundingType)).toEqual(["STATE_ASSIGNED"]);

    // Inscription privée : l'ajout de la part État reprend le comportement historique (principal = État, avec référence).
    const priv = await enroll();
    const v = unwrap(await upsertEnrollmentFundingShare(w.deps, w.ctx, priv.id, { share: { ...state(0), share: { kind: "AMOUNT", amount: 300_000, currency: "XOF" } }, assignmentIssuedOn: "2026-09-01", reason: "Dossier d'affectation vérifié" }));
    expect(v.principalFundingType).toBe("STATE_ASSIGNED");
    const row = (await adminRows<{ assignment_reference: string; d: string }>(db, "SELECT assignment_reference, to_char(assignment_issued_on,'YYYY-MM-DD') AS d FROM academic.enrollments WHERE id = $1", [priv.id]))[0]!;
    expect(row).toEqual({ assignment_reference: "AFF-2026-0001", d: "2026-09-01" });
    // Mettre à jour la part de l'État remplace SA part seulement.
    unwrap(await upsertEnrollmentFundingShare(w.deps, w.ctx, priv.id, { share: scholarship(2000), reason: "Bourse ajoutée plus tard" }));
    const again = unwrap(await upsertEnrollmentFundingShare(w.deps, w.ctx, priv.id, { share: { ...state(0), share: { kind: "AMOUNT", amount: 350_000, currency: "XOF" } }, reason: "Avenant : part de l'État révisée" }));
    expect(again.fundings.map((f) => [f.fundingType, f.share.kind === "AMOUNT" ? f.share.amount : f.share.bps])).toEqual([["SCHOLARSHIP", 2000], ["STATE_ASSIGNED", 350_000]]);
  });

  it("route historique inchangée : une inscription sans cumul se lit comme avant", async () => {
    const e = await enroll();
    unwrap(await changeEnrollmentFunding(w.deps, w.ctx, e.id, { fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-LEGACY", reason: "Affectation reçue" }));
    expect(unwrap(await listEnrollmentFundings(w.deps, w.ctx, e.id))).toMatchObject({ principalFundingType: "STATE_ASSIGNED", fundings: [], familyRemainderBps: 10_000 });
  });

  it("isolation A/B : le tenant B ne voit ni ne modifie le cumul du tenant A", async () => {
    const e = await enroll();
    unwrap(await setEnrollmentFundings(w.deps, w.ctx, e.id, { shares: [scholarship(1000)], reason: "Bourse de test" }));
    const tenantB = await db.createTenant();
    const b = ctxFor(tenantB, newId(), ["admin"], { mfa: true });
    expect(codeOf(await listEnrollmentFundings(w.deps, b, e.id))).toBe("academic.enrollment_not_found");
    expect(codeOf(await setEnrollmentFundings(w.deps, b, e.id, { shares: [], reason: "Tentative inter-tenant" }))).toBe("academic.enrollment_not_found");
    expect(await w.deps.db.run(b, (tx) => tx.many("SELECT * FROM academic.enrollment_fundings"))).toEqual([]);
    expect((await adminRows(db, "SELECT 1 FROM academic.enrollment_fundings WHERE enrollment_id = $1 AND status = 'ACTIVE'", [e.id])).length).toBe(1);
  });
});
