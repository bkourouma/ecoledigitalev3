import { ProfessionalPaymentService } from "../services/professional-payment.service";

/**
 * Répartition d'un règlement sur les commandes d'un lot.
 *
 * `allocateAcrossOrders` est le cœur financier de l'encaissement : une ligne du
 * barème se règle en imputant le montant sur les commandes correspondantes
 * (`/scolarite/lots/.../pay`), pour les deux écrans de paiement. Un écart ici se
 * traduirait en argent mal imputé, d'où ces tests sur la mécanique elle-même,
 * sans base de données.
 */

interface InsertedPayment {
  orderId: string;
  montant: number;
  mode: string;
  reference: string | null;
  receiptNumber: string;
}

interface OrderUpdate {
  orderId: string;
  statut: string;
}

/**
 * Client PostgreSQL simulé : compte les paiements pour la numérotation des
 * reçus, enregistre les écritures au lieu de les exécuter, et sait échouer sur
 * demande pour éprouver le SAVEPOINT.
 */
function makeClient(echecs: { code?: string; constraint?: string }[] = []) {
  const payments: InsertedPayment[] = [];
  const updates: OrderUpdate[] = [];
  const transactionnel: string[] = [];

  const client = {
    payments,
    updates,
    transactionnel,
    async query(sql: string, params: any[] = []) {
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(sql)) {
        transactionnel.push(sql);
        return { rows: [] };
      }
      if (sql.includes("count(*)::int AS n")) return { rows: [{ n: payments.length }] };

      if (sql.includes("INSERT INTO professional_payments")) {
        const echec = echecs.shift();
        if (echec) throw Object.assign(new Error("violation d'unicité"), echec);
        payments.push({
          orderId: params[1],
          montant: params[2],
          mode: params[3],
          reference: params[4],
          receiptNumber: params[5],
        });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("UPDATE professional_orders")) {
        updates.push({ statut: params[0], orderId: params[1] });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Requête inattendue : ${sql}`);
    },
  };

  return client;
}

/** Appelle la méthode privée — c'est bien son comportement qu'on teste. */
function allocate(
  client: ReturnType<typeof makeClient>,
  orders: { order_id: string; montant_total: number; paid: number }[],
  input: { montant: number; mode: string; reference_transaction?: string | null }
): Promise<number> {
  const service = new ProfessionalPaymentService({} as any);
  return (service as any).allocateAcrossOrders(client, "tenant-1", orders, input);
}

describe("allocateAcrossOrders", () => {
  it("impute un règlement partiel sur la première commande seulement", async () => {
    const client = makeClient();
    const left = await allocate(
      client,
      [
        { order_id: "o1", montant_total: 100000, paid: 0 },
        { order_id: "o2", montant_total: 50000, paid: 0 },
      ],
      { montant: 40000, mode: "especes" }
    );

    expect(left).toBe(0);
    expect(client.payments).toHaveLength(1);
    expect(client.payments[0]).toMatchObject({ orderId: "o1", montant: 40000 });
    // La commande n'est pas soldée : elle reste en attente.
    expect(client.updates).toEqual([{ orderId: "o1", statut: "en_attente_paiement" }]);
  });

  it("déborde sur les commandes suivantes sans dépasser le reste de chacune", async () => {
    const client = makeClient();
    const left = await allocate(
      client,
      [
        { order_id: "o1", montant_total: 100000, paid: 60000 },
        { order_id: "o2", montant_total: 50000, paid: 0 },
        { order_id: "o3", montant_total: 30000, paid: 0 },
      ],
      { montant: 70000, mode: "mobile_money" }
    );

    expect(left).toBe(0);
    expect(client.payments.map((p) => [p.orderId, p.montant])).toEqual([
      ["o1", 40000], // complète les 100 000
      ["o2", 30000], // entame la suivante
    ]);
    expect(client.updates).toEqual([
      { orderId: "o1", statut: "payee" },
      { orderId: "o2", statut: "en_attente_paiement" },
    ]);
  });

  it("saute les commandes déjà soldées", async () => {
    const client = makeClient();
    await allocate(
      client,
      [
        { order_id: "o1", montant_total: 100000, paid: 100000 },
        { order_id: "o2", montant_total: 50000, paid: 0 },
      ],
      { montant: 50000, mode: "especes" }
    );

    expect(client.payments).toHaveLength(1);
    expect(client.payments[0].orderId).toBe("o2");
    expect(client.updates).toEqual([{ orderId: "o2", statut: "payee" }]);
  });

  it("ne porte la référence de transaction que sur la première ligne", async () => {
    const client = makeClient();
    await allocate(
      client,
      [
        { order_id: "o1", montant_total: 10000, paid: 0 },
        { order_id: "o2", montant_total: 10000, paid: 0 },
      ],
      { montant: 20000, mode: "virement", reference_transaction: "TX-42" }
    );

    expect(client.payments.map((p) => p.reference)).toEqual(["TX-42", null]);
  });

  it("donne un numéro de reçu distinct à chaque ligne", async () => {
    const client = makeClient();
    await allocate(
      client,
      [
        { order_id: "o1", montant_total: 10000, paid: 0 },
        { order_id: "o2", montant_total: 10000, paid: 0 },
      ],
      { montant: 20000, mode: "especes" }
    );

    const numeros = client.payments.map((p) => p.receiptNumber);
    expect(new Set(numeros).size).toBe(numeros.length);
  });

  it("renvoie le reliquat quand les commandes ne peuvent pas tout absorber", async () => {
    const client = makeClient();
    const left = await allocate(client, [{ order_id: "o1", montant_total: 10000, paid: 0 }], {
      montant: 15000,
      mode: "especes",
    });

    expect(left).toBe(5000);
    expect(client.payments).toEqual([expect.objectContaining({ orderId: "o1", montant: 10000 })]);
  });

  it("n'écrit rien quand tout est déjà réglé", async () => {
    const client = makeClient();
    const left = await allocate(client, [{ order_id: "o1", montant_total: 10000, paid: 10000 }], {
      montant: 5000,
      mode: "especes",
    });

    expect(left).toBe(5000);
    expect(client.payments).toHaveLength(0);
    expect(client.updates).toHaveLength(0);
  });

  it("protège chaque écriture par un SAVEPOINT", async () => {
    const client = makeClient();
    await allocate(client, [{ order_id: "o1", montant_total: 10000, paid: 0 }], {
      montant: 10000,
      mode: "especes",
    });

    expect(client.transactionnel).toEqual([
      "SAVEPOINT ligne_paiement",
      "RELEASE SAVEPOINT ligne_paiement",
    ]);
  });

  it("régénère un numéro de reçu après collision, sans casser la transaction", async () => {
    const client = makeClient([{ code: "23505", constraint: "uniq_prof_payment_receipt" }]);
    const left = await allocate(client, [{ order_id: "o1", montant_total: 10000, paid: 0 }], {
      montant: 10000,
      mode: "especes",
    });

    expect(left).toBe(0);
    expect(client.payments).toHaveLength(1);
    // La tentative ratée a été défaite, puis une nouvelle a abouti.
    expect(client.transactionnel).toEqual([
      "SAVEPOINT ligne_paiement",
      "ROLLBACK TO SAVEPOINT ligne_paiement",
      "SAVEPOINT ligne_paiement",
      "RELEASE SAVEPOINT ligne_paiement",
    ]);
  });

  it("ne réessaie PAS sur une référence de transaction en double", async () => {
    const client = makeClient([{ code: "23505", constraint: "uniq_prof_payment_txref" }]);

    await expect(
      allocate(client, [{ order_id: "o1", montant_total: 10000, paid: 0 }], {
        montant: 10000,
        mode: "especes",
        reference_transaction: "TX-DOUBLON",
      })
    ).rejects.toThrow();

    expect(client.payments).toHaveLength(0);
    expect(client.transactionnel).toEqual([
      "SAVEPOINT ligne_paiement",
      "ROLLBACK TO SAVEPOINT ligne_paiement",
    ]);
  });
});
