import { heureDejaPayeeSQL } from "../services/hour-collectors/heures-consommees";
import { ProfessionalHourCollector } from "../services/hour-collectors/professional-hour-collector";
import { AcademicHourCollector } from "../services/hour-collectors/academic-hour-collector";
import type { HourCollectionScope } from "../services/hour-collectors/types";

/**
 * Tests — une heure validée n'est payable qu'UNE fois (feature 031).
 *
 * Cette garantie venait auparavant du calendrier : deux périodes ne pouvaient
 * pas se recouvrir, donc une séance ne tombait que dans une seule. Depuis que
 * le chevauchement est autorisé (migration 0112), elle doit venir des heures
 * elles-mêmes. Sans ces tests, la régression est silencieuse : le calcul rend
 * un montant plausible, simplement payé deux fois.
 */

/** Client pg factice : capture la requête au lieu de l'exécuter. */
function fakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    client: {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    } as any,
  };
}

const scope: HourCollectionScope = {
  tenantId: "tenant-1",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  periodId: "periode-courante",
};

/** Les espaces sont normalisés : une reindentation ne doit rien casser. */
const plat = (sql: string) => sql.replace(/\s+/g, " ");

describe("Fragment SQL « heure déjà payée »", () => {
  const sql = plat(heureDejaPayeeSQL("seance_id", "se.id", "se.tenant_id", "$6"));

  it("cherche la référence dans le détail des bulletins", () => {
    expect(sql).toContain("FROM payment_hour_details phd");
    expect(sql).toContain("JOIN teacher_payments tp ON tp.id = phd.payment_id");
    expect(sql).toContain("phd.seance_id = se.id");
  });

  it("reste borné au tenant", () => {
    expect(sql).toContain("phd.tenant_id = se.tenant_id");
  });

  it("relâche les heures d'un bulletin annulé", () => {
    // Annuler veut dire que le paiement n'a pas eu lieu : les heures redeviennent
    // dues. Sans cette clause, annuler un bulletin gèlerait ses heures à jamais.
    expect(sql).toContain("tp.status <> 'cancelled'");
  });

  it("n'exclut PAS les heures de la période en cours de calcul", () => {
    // Un recalcul réécrit son propre détail. S'il traitait ses lignes comme
    // consommées, le second passage produirait un bulletin vide.
    expect(sql).toContain("tp.payment_period_id IS DISTINCT FROM $6::uuid");
  });

  it("ne dépend pas de l'archivage", () => {
    // Archiver ne relâche rien : un bulletin archivé reste payé.
    expect(sql).not.toContain("archived_at");
  });

  it("s'adapte à l'origine académique", () => {
    const academique = plat(
      heureDejaPayeeSQL("attendance_session_id", "s.id", "s.tenant_id", "$6")
    );
    expect(academique).toContain("phd.attendance_session_id = s.id");
  });
});

describe("Collecteur professionnel", () => {
  it("écarte les séances déjà payées et passe la période courante", async () => {
    const { client, calls } = fakeClient();
    await new ProfessionalHourCollector().collect(client, scope);

    const { sql, params } = calls[0];
    expect(plat(sql)).toContain("AND NOT EXISTS");
    expect(plat(sql)).toContain("phd.seance_id = se.id");
    // La période courante doit arriver en $6, sinon l'exclusion porte sur la
    // mauvaise valeur et le collecteur s'exclut lui-même.
    expect(params[5]).toBe("periode-courante");
  });

  it("applique toujours le prédicat de payabilité en plus", async () => {
    const { client, calls } = fakeClient();
    await new ProfessionalHourCollector().collect(client, scope);

    // Éligibilité ET disponibilité : les deux, jamais l'une à la place de l'autre.
    expect(plat(calls[0].sql)).toContain("se.validated_at IS NOT NULL");
  });
});

describe("Collecteur académique", () => {
  it("écarte les séances déjà payées et passe la période courante", async () => {
    const { client, calls } = fakeClient();
    await new AcademicHourCollector().collect(client, scope);

    const { sql, params } = calls[0];
    expect(plat(sql)).toContain("AND NOT EXISTS");
    expect(plat(sql)).toContain("phd.attendance_session_id = s.id");
    expect(params[5]).toBe("periode-courante");
  });
});

describe("Restriction par enseignant", () => {
  it("reste indépendante de l'exclusion des heures consommées", async () => {
    const { client, calls } = fakeClient();
    await new ProfessionalHourCollector().collect(client, {
      ...scope,
      teacherIds: ["teacher-1", "teacher-2"],
    });

    const { params } = calls[0];
    expect(params[3]).toBe(true);
    expect(params[4]).toEqual(["teacher-1", "teacher-2"]);
    expect(params[5]).toBe("periode-courante");
  });

  it("passe un tableau vide quand aucun enseignant n'est ciblé", async () => {
    const { client, calls } = fakeClient();
    await new ProfessionalHourCollector().collect(client, scope);

    expect(calls[0].params[3]).toBe(false);
    expect(calls[0].params[4]).toEqual([]);
  });
});
