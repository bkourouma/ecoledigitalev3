import { basculerSeanceRealisee } from "../services/professional-seance-constat";

/**
 * Tests — faire l'appel vaut constat de réalisation (feature 031, US1).
 *
 * La bascule existait sur le chemin ADMINISTRATION et manquait sur le chemin
 * ENSEIGNANT : la séance gardait « planifiée » malgré ses pointages, et
 * l'écran de validation la refusait au motif « Non marquée réalisée ». Ces
 * tests portent sur l'expression partagée par les deux chemins.
 */

/** Client pg factice : capture la requête au lieu de l'exécuter. */
function fakeClient(rowCount = 1) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    client: {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: rowCount ? [{ id: "seance-1" }] : [], rowCount };
      },
    } as any,
  };
}

const plat = (sql: string) => sql.replace(/\s+/g, " ");

describe("Bascule « planifiée → réalisée »", () => {
  it("ne touche que les séances planifiées", async () => {
    const { client, calls } = fakeClient();
    await basculerSeanceRealisee(client, "tenant-1", "seance-1", "user-1");

    const sql = plat(calls[0].sql);
    expect(sql).toContain("SET statut = 'realisee'");
    // Sans cette clause, un pointage résiduel ressusciterait une séance annulée.
    expect(sql).toContain("AND statut = 'planifiee'");
  });

  it("reste borné au tenant et à la séance visée", async () => {
    const { client, calls } = fakeClient();
    await basculerSeanceRealisee(client, "tenant-1", "seance-1", "user-1");

    expect(plat(calls[0].sql)).toContain("WHERE id = $1 AND tenant_id = $2");
    expect(calls[0].params).toEqual(["seance-1", "tenant-1", "user-1"]);
  });

  it("ne valide PAS la séance", async () => {
    const { client, calls } = fakeClient();
    await basculerSeanceRealisee(client, "tenant-1", "seance-1", "user-1");

    // Constater n'est pas engager la dépense : la validation comptable reste
    // un acte distinct. Toucher validated_at ici paierait sur un simple appel.
    expect(calls[0].sql).not.toContain("validated_at");
    expect(calls[0].sql).not.toContain("validated_by");
  });

  it("trace l'auteur du changement de statut", async () => {
    const { client, calls } = fakeClient();
    await basculerSeanceRealisee(client, "tenant-1", "seance-1", "user-1");

    const sql = plat(calls[0].sql);
    expect(sql).toContain("statut_modifie_par = $3");
    expect(sql).toContain("statut_modifie_le = now()");
  });

  it("accepte un auteur inconnu sans casser la bascule", async () => {
    const { client, calls } = fakeClient();
    await basculerSeanceRealisee(client, "tenant-1", "seance-1", undefined);

    expect(calls[0].params[2]).toBeNull();
  });

  it("dit si la séance a effectivement basculé", async () => {
    const bascule = await basculerSeanceRealisee(
      fakeClient(1).client,
      "tenant-1",
      "seance-1",
      "user-1"
    );
    expect(bascule).toBe(true);

    // Déjà réalisée ou annulée : aucune ligne touchée, donc aucune bascule.
    const inchangee = await basculerSeanceRealisee(
      fakeClient(0).client,
      "tenant-1",
      "seance-1",
      "user-1"
    );
    expect(inchangee).toBe(false);
  });
});
