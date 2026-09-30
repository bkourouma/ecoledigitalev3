import {
  inscriptionSoldee,
  confirmerSiInscriptionSoldee,
} from "../professional-inscription-gate";
import {
  semestreClotureDeSession,
  semestreClotureDeEvaluation,
  messageCloture,
} from "../professional-cloture-guard";

/**
 * Les deux verrous du module professionnel, testés sur leur logique de
 * décision — pas sur leur SQL.
 *
 * On injecte un client factice : ces tests disent QUAND le verrou tombe et ce
 * qu'il écrit, sans toucher à la base. Le SQL lui-même est couvert par les
 * vérifications faites en environnement réel (une session d'un semestre
 * clôturé est refusée, une session d'un semestre ouvert ne l'est pas).
 */

type Appel = { sql: string; params: unknown[] };

/**
 * Client factice : répond aux `SELECT` par les lignes fournies, enregistre
 * tout ce qui est exécuté pour qu'on puisse vérifier ce qui a été écrit.
 */
function clientFactice(reponses: Array<{ rows: any[]; rowCount?: number }>) {
  const appels: Appel[] = [];
  let i = 0;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      appels.push({ sql, params });
      const r = reponses[i] ?? { rows: [] };
      i += 1;
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
  };
  return { client: client as any, appels };
}

const T = "11111111-1111-1111-1111-111111111111";
const ETU = "22222222-2222-2222-2222-222222222222";
const PROG = "33333333-3333-3333-3333-333333333333";
const SESSION = "44444444-4444-4444-4444-444444444444";

describe("Verrou frais d'inscription — inscriptionSoldee", () => {
  it("considère soldée une classe SANS frais d'inscription au barème", async () => {
    // Aucune commande de nature 'inscription' : la somme vaut 0 des deux côtés.
    const { client } = clientFactice([{ rows: [{ du: 0, paye: 0 }] }]);
    await expect(inscriptionSoldee(client, T, ETU, PROG)).resolves.toBe(true);
  });

  it("refuse tant qu'il reste des frais d'inscription dus", async () => {
    const { client } = clientFactice([{ rows: [{ du: 150000, paye: 50000 }] }]);
    await expect(inscriptionSoldee(client, T, ETU, PROG)).resolves.toBe(false);
  });

  it("accepte le solde complet", async () => {
    const { client } = clientFactice([{ rows: [{ du: 150000, paye: 150000 }] }]);
    await expect(inscriptionSoldee(client, T, ETU, PROG)).resolves.toBe(true);
  });

  it("tolère un reliquat inférieur à un demi-franc (arrondis)", async () => {
    const { client } = clientFactice([{ rows: [{ du: 150000, paye: 149999.6 }] }]);
    await expect(inscriptionSoldee(client, T, ETU, PROG)).resolves.toBe(true);
  });

  it("sans classe rattachée, rien n'est dû : la scolarité s'ouvre", async () => {
    const { client, appels } = clientFactice([]);
    await expect(inscriptionSoldee(client, T, ETU, null)).resolves.toBe(true);
    expect(appels).toHaveLength(0);
  });
});

describe("Verrou frais d'inscription — confirmerSiInscriptionSoldee", () => {
  it("confirme les inscriptions quand les frais sont soldés", async () => {
    const { client, appels } = clientFactice([
      { rows: [{ du: 0, paye: 0 }] }, // inscriptionSoldee
      { rows: [], rowCount: 2 }, // UPDATE
    ]);
    await expect(confirmerSiInscriptionSoldee(client, T, ETU, PROG)).resolves.toBe(true);

    const update = appels[1];
    expect(update.sql).toMatch(/UPDATE professional_enrollments/);
    expect(update.sql).toMatch(/SET statut = 'confirmee'/);
    // Idempotence : seules les lignes encore en attente sont touchées.
    expect(update.sql).toMatch(/e\.statut = 'en_attente_paiement'/);
  });

  it("n'écrit RIEN quand les frais ne sont pas soldés", async () => {
    const { client, appels } = clientFactice([{ rows: [{ du: 150000, paye: 0 }] }]);
    await expect(confirmerSiInscriptionSoldee(client, T, ETU, PROG)).resolves.toBe(false);
    expect(appels).toHaveLength(1);
    expect(appels[0].sql).not.toMatch(/UPDATE/);
  });
});

describe("Verrou de clôture — semestreClotureDeSession", () => {
  it("laisse passer une cohorte dont aucun semestre n'est clôturé", async () => {
    const { client } = clientFactice([{ rows: [] }]);
    await expect(semestreClotureDeSession(client, T, SESSION)).resolves.toBeNull();
  });

  it("bloque une cohorte rattachée à un semestre clôturé", async () => {
    const { client } = clientFactice([
      {
        rows: [
          {
            semestre_id: "55555555-5555-5555-5555-555555555555",
            libelle: "Semestre 1",
            bulletins_clotures_at: "2026-09-22T17:23:31.546Z",
          },
        ],
      },
    ]);
    const sem = await semestreClotureDeSession(client, T, SESSION);
    expect(sem).not.toBeNull();
    expect(sem!.libelle).toBe("Semestre 1");
  });

  it("interroge les DEUX chemins de rattachement au semestre", async () => {
    // Le lien direct et le lien par l'UE. N'en interroger qu'un laisserait le
    // verrou ouvert pour toutes les cohortes créées par lot.
    const { client, appels } = clientFactice([{ rows: [] }]);
    await semestreClotureDeSession(client, T, SESSION);
    expect(appels[0].sql).toMatch(/professional_semestre_sessions/);
    expect(appels[0].sql).toMatch(/professional_semestre_ue/);
  });
});

describe("Verrou de clôture — message", () => {
  it("nomme le semestre et la date, et ne promet pas de réouverture", () => {
    const msg = messageCloture({
      semestre_id: "55555555-5555-5555-5555-555555555555",
      libelle: "Semestre 1 E2E",
      bulletins_clotures_at: "2026-09-22T17:23:31.546Z",
    });
    expect(msg).toContain("Semestre 1 E2E");
    expect(msg).toContain("22/09/2026");
    // Aucune route ne remet bulletins_clotures_at à NULL : ne pas envoyer
    // l'utilisateur chercher une porte qui n'existe pas.
    expect(msg.toLowerCase()).not.toContain("rouvr");
  });
});

describe("Verrou de clôture — semestreClotureDeEvaluation (correction d'une copie)", () => {
  const ASSIGN = "66666666-6666-6666-6666-666666666666";
  const CLOTURE = {
    semestre_id: "55555555-5555-5555-5555-555555555555",
    libelle: "Semestre 3",
    bulletins_clotures_at: "2026-09-22T17:23:31.546Z",
  };

  it("bloque la correction d'une évaluation rattachée à une cohorte clôturée", async () => {
    const { client } = clientFactice([
      { rows: [{ ecue_id: "e1", ue_session_id: SESSION }] },
      { rows: [CLOTURE] },
    ]);
    const sem = await semestreClotureDeEvaluation(client, T, ASSIGN, ETU);
    expect(sem?.libelle).toBe("Semestre 3");
  });

  it("laisse passer si la cohorte n'est dans aucun semestre clôturé", async () => {
    const { client } = clientFactice([
      { rows: [{ ecue_id: "e1", ue_session_id: SESSION }] },
      { rows: [] },
    ]);
    await expect(semestreClotureDeEvaluation(client, T, ASSIGN, ETU)).resolves.toBeNull();
  });

  it("sans cohorte sur l'évaluation, examine celles où l'étudiant est inscrit", async () => {
    const { client, appels } = clientFactice([
      { rows: [{ ecue_id: "e1", ue_session_id: null }] },
      { rows: [{ id: SESSION }] },
      { rows: [CLOTURE] },
    ]);
    const sem = await semestreClotureDeEvaluation(client, T, ASSIGN, ETU);
    expect(sem?.libelle).toBe("Semestre 3");
    expect(appels[1].sql).toMatch(/professional_enrollments/);
  });
});
