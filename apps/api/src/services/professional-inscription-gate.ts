import type { PoolClient } from "pg";

/**
 * Porte d'entrée de la scolarité — Module Professionnel.
 *
 * Une inscription à une UE naît `en_attente_paiement`. Elle ne devient
 * `confirmee` que si les FRAIS D'INSCRIPTION du barème de la classe sont
 * soldés. Tant qu'elle ne l'est pas, toute la scolarité la considère absente :
 * ni présences, ni notes, ni conduite, ni bulletin, ni attestation.
 *
 * Ce module existe parce que cette règle était jusqu'ici enfermée dans le
 * service de paiement, et n'était donc évaluée QUE lors d'un encaissement.
 * Conséquence : une classe sans frais d'inscription — où rien n'est dû, donc
 * où la condition est tenue d'emblée — ne déclenchait jamais l'évaluation, et
 * ses inscrits restaient invisibles indéfiniment. La règle est la même
 * qu'avant ; elle est simplement devenue appelable depuis l'inscription.
 */

/**
 * Statuts d'inscription qui ouvrent la scolarité.
 *
 * Toute requête qui compte ou liste des inscrits À DES FINS PÉDAGOGIQUES doit
 * s'aligner sur cette liste. Les écrans de facturation, eux, raisonnent sur
 * les commandes et n'ont pas à l'utiliser.
 */
export const INSCRIPTION_STATUTS_SCOLARITE = ["confirmee", "terminee"] as const;

/** Fragment SQL prêt à interpoler, pour éviter que la liste ne diverge. */
export const SQL_STATUTS_SCOLARITE = "('confirmee','terminee')";

/**
 * Les frais d'inscription du lot sont-ils soldés ?
 *
 * C'est la condition d'une inscription COMPLÈTE. Une classe sans frais
 * d'inscription au barème ne bloque personne : rien n'étant dû, la condition
 * est tenue d'emblée.
 */
export async function inscriptionSoldee(
  client: PoolClient,
  tenantId: string,
  studentId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!programmeId) return true;

  const res = await client.query(
    `SELECT COALESCE(SUM(o.montant_total), 0)::float8 AS du,
            COALESCE(SUM((SELECT COALESCE(SUM(pm.montant), 0) FROM professional_payments pm
                          WHERE pm.order_id = o.id AND pm.statut = 'confirme')), 0)::float8 AS paye
     FROM professional_orders o
     WHERE o.tenant_id = $1 AND o.student_id = $2 AND o.programme_id = $3
       AND o.nature = 'inscription' AND o.statut <> 'annulee'`,
    [tenantId, studentId, programmeId]
  );

  const { du, paye } = res.rows[0];
  return Number(du) - Number(paye) <= 0.5;
}

/**
 * Confirme les inscriptions aux UE d'un lot, mais seulement si les frais
 * d'inscription sont soldés. Sans quoi elles restent en attente : c'est ce
 * qui rend l'inscription « incomplète » côté étudiant.
 *
 * Idempotent : ne touche que les lignes encore `en_attente_paiement`.
 * Renvoie `true` si la condition est tenue (donc si la scolarité est ouverte),
 * indépendamment du nombre de lignes effectivement basculées.
 */
export async function confirmerSiInscriptionSoldee(
  client: PoolClient,
  tenantId: string,
  studentId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!(await inscriptionSoldee(client, tenantId, studentId, programmeId))) return false;

  await client.query(
    `UPDATE professional_enrollments e
     SET statut = 'confirmee', updated_at = now()
     FROM professional_orders o
     WHERE o.id = e.order_id AND e.tenant_id = $1 AND o.student_id = $2
       AND ($3::uuid IS NULL OR o.programme_id = $3::uuid)
       AND e.statut = 'en_attente_paiement'`,
    [tenantId, studentId, programmeId]
  );
  return true;
}
