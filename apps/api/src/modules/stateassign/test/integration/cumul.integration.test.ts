/**
 * O-04 : cumul de financements (bourse + État + famille) vu par le rapprochement de `stateassign` (ports en mémoire, base réelle).
 *
 * La part « famille » déclarée par l'acte est ce que la famille doit AVANT les autres financeurs ; elle se compare donc à la facture de
 * la famille PLUS les factures des autres financeurs. Sans autre financeur, rien ne change (non-régression).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { actOnAssignment, recordAssignment } from "../../application/assignments";
import { reconcileAssignment } from "../../application/reconciliation";
import { billedOf } from "../../application/reconciliation";
import { billingOf } from "../../infrastructure/in-memory-ports";
import type { StateFundingBilling } from "../../application/ports";
import { PEOPLE, createEnv, errorCodeOf, unwrapOk, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
beforeAll(async () => {
  env = await createEnv({ startAt: "2026-10-15T09:00:00.000Z" });
});
afterAll(async () => {
  await env?.close();
});

const human = (t: string) => env.user(t, PEOPLE.bursar);
const FOUNDATION = "00000000-0000-4000-8000-0000000000a2";

/** Acte : 300 000 pour l'État, 200 000 pour la famille (dont une bourse de 100 000 d'une fondation). */
async function dossier(t: string) {
  const e = env.enroll({ studentName: "DIABATE Fanta" });
  const a = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: `AFF-${uuid().slice(0, 6)}`, declaredStateAmount: 300000, declaredParentAmount: 200000, issuingAuthority: "Autorité" }));
  unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
  const active = unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "activate", {}));
  return { ...e, id: active.id };
}

const withFoundation = (base: StateFundingBilling, total: number, paid = 0): StateFundingBilling => ({
  ...base,
  otherFunderInvoices: [
    {
      invoiceId: "00000000-0000-4000-8000-0000000000b3",
      number: "FAC-b003",
      status: paid >= total ? "PAID" : "ISSUED",
      total: Money.of(total, "XOF"),
      paid: Money.of(paid, "XOF"),
      credited: Money.of(0, "XOF"),
      dueDate: "2026-12-01",
      scholarshipId: FOUNDATION,
      funderKind: "FOUNDATION",
      funderName: "Fondation Espoir",
    },
  ],
});

describeIntegration("stateassign : rapprochement avec cumul de financements", () => {
  it("bourse 100 000 + État 300 000 + famille 100 000 : BALANCED — la bourse est comptée avec la part de la famille déclarée (200 000)", async () => {
    const t = await env.tenant();
    const d = await dossier(t);
    env.world.setBilling(d.enrollmentId, withFoundation(billingOf({ stateTotal: 300000, parentTotal: 100000 }), 100000));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "BALANCED", stateDelta: { amount: 0 }, parentDelta: { amount: 0 }, parentBilled: { amount: 200000 } });
    expect(r.billing.otherFunderInvoices).toHaveLength(1);
    expect(r.billing.otherFunderInvoices[0]).toMatchObject({ scholarshipId: FOUNDATION, funderKind: "FOUNDATION", funderName: "Fondation Espoir", total: { amount: 100000 } });
    expect(r.warnings.join(" ")).toMatch(/Cumul de financements/);
    // La part payée par la bourse n'est jamais confondue avec les versements de l'État.
    expect(r.unallocated.amount).toBe(0);
  });

  it("non-régression : sans autre financeur le résultat est celui d'avant (la facture de la famille seule est comparée)", async () => {
    const t = await env.tenant();
    const d = await dossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 300000, parentTotal: 100000 }));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "DISCREPANCY", parentDelta: { amount: -100000 } });
    expect(r.billing.otherFunderInvoices).toEqual([]);
    expect(r.warnings.join(" ")).not.toMatch(/Cumul/);
  });

  it("une bourse facturée en trop (ou en moins) fait apparaître l'écart sur la part famille, pas sur celle de l'État", async () => {
    const t = await env.tenant();
    const d = await dossier(t);
    env.world.setBilling(d.enrollmentId, withFoundation(billingOf({ stateTotal: 300000, parentTotal: 100000 }), 150000));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "DISCREPANCY", stateDelta: { amount: 0 }, parentDelta: { amount: 50000 } });
  });

  it("les paiements des financeurs restent séparés : seuls ceux de l'État sont affectés aux échéances de l'État ; les non rattachés sont signalés", async () => {
    const t = await env.tenant();
    const d = await dossier(t);
    const base = billingOf({ stateTotal: 300000, statePaid: 100000, parentTotal: 100000 });
    const billing: StateFundingBilling = {
      ...withFoundation(base, 100000, 100000),
      unattributedPayments: [{ paymentId: uuid(), receivedAt: new Date("2026-10-10T08:00:00Z"), amount: Money.of(100000, "XOF"), allocated: Money.of(100000, "XOF"), reference: "VIR-1" }],
    };
    env.world.setBilling(d.enrollmentId, billing);
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(billedOf(billing)).toMatchObject({ statePaid: { amount: 100000 }, otherFunders: { amount: 100000 } });
    expect(r.billing.unattributedPayments).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/sans référence de prise en charge/);
  });

  it("la vérification transmet à academic le montant de l'État déclaré (sa part du cumul)", async () => {
    const t = await env.tenant();
    const before = env.world.fundingCalls.length;
    await dossier(t);
    const call = env.world.fundingCalls.at(-1)!;
    expect(env.world.fundingCalls.length).toBe(before + 1);
    expect(call.stateAmount).toMatchObject({ amount: 300000, currency: "XOF" });
  });

  it("isolation A/B : un autre établissement ne rapproche pas le dossier (introuvable)", async () => {
    const a = await env.tenant();
    const b = await env.tenant();
    const d = await dossier(a);
    env.world.setBilling(d.enrollmentId, withFoundation(billingOf({ stateTotal: 300000, parentTotal: 100000 }), 100000));
    const r = await reconcileAssignment(env.deps, human(b), d.id);
    expect(errorCodeOf(r)).toBe("stateassign.assignment_not_found");
  });
});
