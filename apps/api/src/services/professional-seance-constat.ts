import type { PoolClient } from "pg";

/**
 * Constat de réalisation d'une séance — le pendant « pédagogique » de la
 * validation comptable.
 *
 * POURQUOI CE FICHIER EXISTE
 * Faire l'appel atteste que le cours a eu lieu : l'enseignant était devant ses
 * étudiants. La bascule « planifiée → réalisée » était écrite dans le seul
 * chemin ADMINISTRATION (`professional-ue.service.ts`). Le chemin ENSEIGNANT
 * (`professional-teacher.service.ts`, appelé par /teacher/attendance) posait
 * les mêmes pointages sans jamais toucher au statut : la séance restait
 * « planifiée » malgré son appel, et n'apparaissait payable nulle part sans
 * reprise manuelle par l'administration.
 *
 * Deux chemins pour un même geste métier avaient donc deux effets différents.
 * Comme le prédicat de payabilité, la règle vit désormais à un seul endroit.
 */

/**
 * Passe la séance en « réalisée » si elle est encore « planifiée ».
 *
 * Trois précautions, dans l'ordre où elles comptent :
 *
 *   - SEULES les séances « planifiée » sont touchées. Une séance « annulée »
 *     garde son statut — un pointage résiduel ne doit pas la ressusciter — et
 *     une « réalisée » n'a rien à changer.
 *   - `validated_at` n'est PAS touché. La bascule est un CONSTAT, pas un
 *     engagement de dépense : valider reste un acte distinct, réservé à la
 *     comptabilité.
 *   - L'auteur est tracé dans `statut_modifie_par` / `statut_modifie_le`, que
 *     la bascule vienne de l'enseignant ou de l'administration.
 *
 * @returns true si la séance vient effectivement de basculer.
 */
export async function basculerSeanceRealisee(
  client: PoolClient,
  tenantId: string,
  seanceId: string,
  parUtilisateur?: string | null
): Promise<boolean> {
  const res = await client.query(
    `UPDATE professional_ecue_seances
        SET statut = 'realisee',
            statut_modifie_par = $3,
            statut_modifie_le = now(),
            updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND statut = 'planifiee'
      RETURNING id`,
    [seanceId, tenantId, parUtilisateur ?? null]
  );
  return (res.rowCount ?? 0) > 0;
}
