import type { PoolClient } from "pg";

/**
 * Verrou de clôture — Module Professionnel.
 *
 * Clôturer un semestre arrête ses bulletins : ils sont générés, signés,
 * distribués. La régénération était déjà refusée, mais la SAISIE DES NOTES ne
 * l'était pas : on pouvait modifier une note après clôture, relancer le calcul,
 * et obtenir une moyenne qui contredit un bulletin déjà remis.
 *
 * Une cohorte d'UE se rattache à son semestre par deux chemins — le lien direct
 * (professional_semestre_sessions) et le lien par l'UE
 * (professional_semestre_ue). Les deux sont interrogés : rater le second
 * laisserait le verrou ouvert pour toutes les sessions créées par lot.
 */

export type SemestreCloture = {
  semestre_id: string;
  libelle: string;
  bulletins_clotures_at: string;
};

/**
 * Renvoie le premier semestre CLÔTURÉ auquel appartient cette cohorte d'UE,
 * ou `null` si aucun ne l'est.
 */
export async function semestreClotureDeSession(
  client: PoolClient,
  tenantId: string,
  ueSessionId: string
): Promise<SemestreCloture | null> {
  const res = await client.query(
    `SELECT sm.id AS semestre_id, sm.libelle, sm.bulletins_clotures_at
     FROM professional_semestres sm
     WHERE sm.tenant_id = $1
       AND sm.bulletins_clotures_at IS NOT NULL
       AND (
         EXISTS (
           SELECT 1 FROM professional_semestre_sessions ss
           WHERE ss.tenant_id = sm.tenant_id
             AND ss.semestre_id = sm.id
             AND ss.ue_session_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM professional_semestre_ue su
           JOIN professional_ue_sessions s
             ON s.ue_id = su.ue_id AND s.tenant_id = su.tenant_id
           WHERE su.tenant_id = sm.tenant_id
             AND su.semestre_id = sm.id
             AND s.id = $2
         )
       )
     ORDER BY sm.bulletins_clotures_at ASC
     LIMIT 1`,
    [tenantId, ueSessionId]
  );
  return res.rowCount === 0 ? null : (res.rows[0] as SemestreCloture);
}

/**
 * Message unique, pour que tous les écrans disent la même chose.
 *
 * On ne propose PAS de rouvrir le semestre : aucune route ne remet
 * `bulletins_clotures_at` à NULL aujourd'hui. Promettre une porte qui n'existe
 * pas enverrait l'utilisateur la chercher en vain.
 */
export function messageCloture(sem: SemestreCloture): string {
  const date = new Date(sem.bulletins_clotures_at).toLocaleDateString("fr-FR");
  return `Le semestre « ${sem.libelle} » a été clôturé le ${date} : ses notes ne sont plus modifiables, les bulletins étant arrêtés.`;
}
