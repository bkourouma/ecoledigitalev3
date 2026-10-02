/**
 * Finances : la scolarité des élèves déjà inscrits est réglée de façons variées (solde, partiel en caisse, mobile money) et par
 * paiement EN LIGNE avec le fournisseur SANDBOX (déterministe, aucun appel réseau : un montant se terminant par 001 reste en
 * attente, par 013 échoue). Les autres factures restent impayées, pour tester relances, balance âgée et rapprochement.
 */
import type { Actor } from "../actors";
import { at, type DemoKit } from "./kit";

interface InvoiceRow {
  id: string;
  status: string;
  total: { amount: number };
}

export async function seedFinanceActivity(kit: DemoKit, input: { econome: Actor }): Promise<void> {
  const { ctx } = kit;
  const eco = input.econome;
  const tuition = ctx.data.tuitionFee;
  const active = ctx.students.slice(0, ctx.data.paidCount);
  const tuitionInvoiceOf = async (index: number): Promise<{ learnerId: string; enrollmentId: string; invoice: InvoiceRow }> => {
    const s = at(active, index, "élève");
    const list = (await eco.get(`/api/v1/finance/invoices?learnerId=${s.id}&limit=50`)).body.items as InvoiceRow[];
    const invoice = list.find((i) => i.total.amount === tuition);
    if (!invoice) throw new Error(`Facture de scolarité introuvable (élève ${index + 1}).`);
    return { learnerId: s.id, enrollmentId: s.enrollmentId as string, invoice };
  };
  const key = (k: string): string => `demo-fin-${ctx.data.slug}-${k}`;

  // 1. solde par virement
  const a = await tuitionInvoiceOf(0);
  await eco.post("/api/v1/finance/payments", { learnerId: a.learnerId, enrollmentId: a.enrollmentId, amount: tuition, method: "TRANSFER", reference: `VIR-DEMO-${ctx.data.slug}-1`, allocation: { mode: "AUTO", invoiceIds: [a.invoice.id] } }, [200, 201], { "idempotency-key": key("transfer-full") });
  // 2. règlement partiel par mobile money
  const b = await tuitionInvoiceOf(1);
  await eco.post(
    "/api/v1/finance/payments",
    { learnerId: b.learnerId, enrollmentId: b.enrollmentId, amount: Math.round(tuition / 2), method: "MOBILE_MONEY", reference: `MM-DEMO-${ctx.data.slug}-1`, allocation: { mode: "AUTO", invoiceIds: [b.invoice.id] } },
    [200, 201],
    { "idempotency-key": key("mm-half") },
  );
  // 3. paiement en ligne SANDBOX réussi
  const c = await tuitionInvoiceOf(2);
  const ok = await eco.post(
    "/api/v1/finance/payments/online",
    { idempotencyKey: key("online-ok"), learnerId: c.learnerId, enrollmentId: c.enrollmentId, amount: 50_000, provider: "sandbox", invoiceId: c.invoice.id, payer: { name: "Parent de démonstration" } },
    [200, 201],
  );
  // 4. paiement en ligne SANDBOX refusé (montant se terminant par 013) : état final, consigné avec son motif.
  // (Pas de paiement « en attente » : la sandbox garde son état en mémoire du processus qui l'a créé ; le testeur en crée un
  //  depuis le portail parent, et la sandbox de l'API le règle.)
  const e = await tuitionInvoiceOf(3);
  await eco.post("/api/v1/finance/payments/online", { idempotencyKey: key("online-failed"), learnerId: e.learnerId, enrollmentId: e.enrollmentId, amount: 20_013, provider: "sandbox", invoiceId: e.invoice.id }, [200, 201]);
  void ok;
  kit.count("demoPayments", 4);
  kit.note("Finance : scolarité soldée (virement), partielle (mobile money), paiements en ligne SANDBOX réussi et refusé (aucun appel réseau, fournisseur déterministe) ; les autres factures restent impayées.");
}
