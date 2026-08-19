/**
 * Heures CONSOMMÉES — feature 031.
 *
 * Une heure validée n'est payable qu'UNE fois. Dès qu'elle figure au détail
 * d'un bulletin (`payment_hour_details`), elle est consommée : aucun calcul
 * ultérieur ne doit la reprendre. Seules les heures neuves alimentent le
 * bulletin suivant.
 *
 * POURQUOI CE FICHIER EXISTE
 * C'était le trou du dispositif. `SEANCE_PAYABLE_PREDICATE` répond à « cette
 * séance est-elle éligible ? » — réalisée, validée, avec bénéficiaire et durée.
 * Il ne connaît pas les bulletins déjà émis. Tant que le chevauchement des
 * périodes était interdit, le calendrier suffisait à garantir l'unicité ; ce
 * n'est plus le cas depuis la migration 0112, qui autorise deux périodes à
 * couvrir les mêmes dates. La garantie doit donc venir des heures elles-mêmes.
 *
 * Comme le prédicat de payabilité, l'expression vit à UN SEUL endroit et est
 * importée par tous ceux qui doivent s'accorder :
 *   - les deux collecteurs d'heures (ce qui sera payé) ;
 *   - la vue d'ensemble de la paie (ce qui est annoncé à l'écran).
 * Une variante recopiée redonnerait l'écart classique : un écran qui annonce
 * des heures que le calcul n'a pas retenues.
 *
 * DEUX POINTS DE SÉMANTIQUE
 *
 * 1. Un bulletin ANNULÉ (`status = 'cancelled'`) relâche ses heures. Annuler
 *    veut dire que le paiement n'a pas eu lieu ; les heures redeviennent dues.
 *    L'archivage, lui, ne relâche rien : un bulletin archivé reste payé.
 *
 * 2. La période EN COURS DE CALCUL ne s'exclut pas elle-même. Un recalcul
 *    réécrit son propre détail (`DELETE` puis `INSERT` dans
 *    teacher-payments.ts) ; s'il considérait ses propres lignes comme
 *    consommées, il produirait un bulletin vide au second passage.
 */

/** Colonne de `payment_hour_details` qui porte la référence, selon l'origine. */
export type ReferenceHeure = "seance_id" | "attendance_session_id";

/**
 * Fragment SQL booléen : « cette heure a déjà été payée ailleurs ».
 *
 * @param refColonne  colonne de rattachement dans `payment_hour_details`
 * @param refExpr     expression SQL désignant l'heure examinée (ex. `se.id`)
 * @param tenantExpr  expression SQL du tenant (ex. `se.tenant_id`)
 * @param periodeParam placeholder de la période en cours de calcul (ex. `$6`).
 *                     Peut valoir NULL : tout bulletin existant compte alors.
 */
export function heureDejaPayeeSQL(
  refColonne: ReferenceHeure,
  refExpr: string,
  tenantExpr: string,
  periodeParam: string
): string {
  return `EXISTS (
    SELECT 1
      FROM payment_hour_details phd
      JOIN teacher_payments     tp ON tp.id = phd.payment_id
     WHERE phd.${refColonne} = ${refExpr}
       AND phd.tenant_id     = ${tenantExpr}
       AND tp.status <> 'cancelled'
       AND tp.payment_period_id IS DISTINCT FROM ${periodeParam}::uuid
  )`;
}
