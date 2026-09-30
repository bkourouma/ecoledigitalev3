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

/**
 * Verrou de clôture pour la CORRECTION d'une copie.
 *
 * Une note de copie alimente le résultat ECUE (auto-capture) : la corriger après
 * clôture ferait bouger une moyenne déjà portée sur un bulletin remis. On cherche
 * donc les cohortes que cette correction toucherait — celle de l'évaluation, ou, si
 * elle n'est rattachée à aucune, toutes celles où l'étudiant est inscrit et dont
 * l'UE porte l'ECUE — et on refuse dès que l'une appartient à un semestre clôturé.
 */
export async function semestreClotureDeEvaluation(
  client: PoolClient,
  tenantId: string,
  assignmentId: string,
  studentId: string
): Promise<SemestreCloture | null> {
  const a = await client.query(
    `SELECT ecue_id, ue_session_id FROM professional_assignments
     WHERE id = $1 AND tenant_id = $2`,
    [assignmentId, tenantId]
  );
  if (a.rowCount === 0) return null;
  const { ecue_id, ue_session_id } = a.rows[0];

  let sessionIds: string[];
  if (ue_session_id) {
    sessionIds = [ue_session_id];
  } else {
    const s = await client.query(
      `SELECT DISTINCT s.id
       FROM professional_enrollments en
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       WHERE en.student_id = $1 AND en.tenant_id = $2
         AND en.statut IN ('confirmee','terminee') AND l.ecue_id = $3`,
      [studentId, tenantId, ecue_id]
    );
    sessionIds = s.rows.map((r) => r.id as string);
  }
  for (const id of sessionIds) {
    const cloture = await semestreClotureDeSession(client, tenantId, id);
    if (cloture) return cloture;
  }
  return null;
}
