import { TeacherPayrollOverviewService } from "../services/teacher-payroll-overview.service";

/**
 * Tests — archiver n'est pas verser (migration 0114).
 *
 * L'archivage posait `status = 'paid'` : 35 bulletins ont ainsi été déclarés
 * payés sans qu'aucun décaissement ne soit enregistré, `paid_at` restant vide.
 * Ces tests verrouillent la séparation des deux actes. Sans eux, la régression
 * est indolore à la lecture du code et invisible à l'écran — jusqu'au jour où
 * un enseignant réclame un versement que l'application dit avoir effectué.
 */

/** Client pg factice : capture la requête au lieu de l'exécuter. */
function fakeClient(rowCount = 3) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    client: {
      query: async (sql: string, params?: unknown[]) => {
        // `withTenantTx` émet BEGIN/COMMIT et pose la GUC du tenant : on ne
        // retient que les requêtes porteuses de données.
        if (params) calls.push({ sql, params });
        return { rows: Array.from({ length: rowCount }, (_, i) => ({ id: `p${i}` })), rowCount };
      },
      release: () => {},
    } as any,
  };
}

function service(client: any) {
  const pool = { connect: async () => client } as any;
  return new TeacherPayrollOverviewService(pool);
}

/**
 * SQL normalisé, COMMENTAIRES RETIRÉS. Les commentaires de ces requêtes citent
 * les valeurs qu'elles n'écrivent plus (« Poser 'paid' ici déclarait… ») : les
 * garder ferait échouer les assertions de non-présence sur un texte explicatif,
 * et pousserait à appauvrir les commentaires pour satisfaire un test.
 */
const plat = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ");

/** La requête qui porte le verbe cherché, parmi celles capturées. */
function requete(calls: { sql: string; params: unknown[] }[], motif: RegExp) {
  const trouvee = calls.find((c) => motif.test(c.sql));
  if (!trouvee) throw new Error(`aucune requete ne correspond a ${motif}`);
  return { sql: plat(trouvee.sql), params: trouvee.params };
}

describe("Archivage — arrête le montant, ne verse pas", () => {
  it("ne pose jamais le statut « payé »", async () => {
    const { client, calls } = fakeClient();
    await service(client).archiverBulletins("t1", null, "u1");

    const { sql } = requete(calls, /archived_at/);
    expect(sql).toContain("status = 'approved'::payment_status");
    // C'est LE point de la migration 0114.
    expect(sql).not.toContain("'paid'");
    expect(sql).not.toContain("paid_at");
  });

  it("trace l'approbation sans écraser une approbation antérieure", async () => {
    const { client, calls } = fakeClient();
    await service(client).archiverBulletins("t1", null, "u1");

    const { sql } = requete(calls, /archived_at/);
    // `COALESCE` : réarchiver ne doit pas redater l'acte initial.
    expect(sql).toContain("approved_at = COALESCE(approved_at, now())");
    expect(sql).toContain("approved_by = COALESCE(approved_by, $3)");
  });

  it("ne touche que ce qui n'est pas déjà classé", async () => {
    const { client, calls } = fakeClient();
    await service(client).archiverBulletins("t1", null, "u1");

    expect(requete(calls, /archived_at/).sql).toContain("archived_at IS NULL");
  });
});

describe("Versement — le seul geste qui remplit paid_at", () => {
  it("pose la date et l'auteur du versement", async () => {
    const { client, calls } = fakeClient();
    await service(client).marquerVerses("t1", null, "u1");

    const { sql, params } = requete(calls, /paid_at/);
    expect(sql).toContain("status = 'paid'::payment_status");
    expect(sql).toContain("paid_at = now()");
    expect(sql).toContain("paid_by = $3");
    expect(params[2]).toBe("u1");
  });

  it("refuse de verser ce qui n'a pas été arrêté", async () => {
    const { client, calls } = fakeClient();
    await service(client).marquerVerses("t1", ["a", "b"], "u1");

    // Le filtre porte sur le STATUT, pas seulement sur les identifiants reçus :
    // un appel large ne doit pas pouvoir court-circuiter la règle.
    expect(requete(calls, /paid_at/).sql).toContain("status = 'approved'::payment_status");
  });

  it("compte les bulletins hors périmètre comme ignorés", async () => {
    const { client } = fakeClient(1);
    const res = (await service(client).marquerVerses("t1", ["a", "b", "c"], "u1")) as {
      data?: { verses: number; ignores: number };
    };
    // 3 demandés, 1 seul éligible : les 2 autres sont déjà versés ou annulés.
    expect(res.data).toEqual({ verses: 1, ignores: 2 });
  });

  it("ne compte aucun ignoré quand aucune liste n'est fournie", async () => {
    const { client } = fakeClient(4);
    const res = (await service(client).marquerVerses("t1", null, "u1")) as {
      data?: { verses: number; ignores: number };
    };
    expect(res.data).toEqual({ verses: 4, ignores: 0 });
  });
});
