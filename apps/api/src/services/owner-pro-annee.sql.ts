/**
 * Date métier d'une commande professionnelle : fragment SQL partagé.
 *
 * LE PROBLÈME QU'IL RÉSOUT
 *
 * `professional_orders.created_at` et `professional_payments.paid_at` portent
 * la date d'ÉCRITURE DE LA LIGNE, pas celle de l'activité. Sur une base
 * alimentée par reprise de données, les 1 360 commandes de cinq années
 * scolaires portent toutes le même horodatage. Tout filtre de période bâti
 * dessus produit alors deux erreurs symétriques :
 *
 *   - les années passées apparaissent VIDES (0 FCFA sur 2021-2022, alors que
 *     240 commandes et 20 étudiants y existent) ;
 *   - l'année du chargement est GONFLÉE de tout l'historique (102 M sur
 *     2025-2026 au lieu de 30 M).
 *
 * Les écrans d'assiduité et de remplissage, eux, lisent les dates de séance et
 * affichent la bonne chose. D'où des écrans voisins qui se contredisent : 50 %
 * de remplissage et 92 % de présence sur une année à « zéro encaissement ».
 *
 * LA RÈGLE RETENUE
 *
 * Une commande appartient à l'année de la CLASSE qu'elle ouvre. Sa date métier
 * est le début de la plus ancienne ouverture à laquelle elle inscrit —
 * `professional_ue_sessions.date_debut`, la seule date de la chaîne qui décrit
 * un fait pédagogique et non une écriture technique. C'est aussi la source du
 * sélecteur d'année (`/owner/stats/filters`) : les périodes proposées et les
 * chiffres affichés reposent enfin sur la même colonne.
 *
 * `MIN` et non `DISTINCT` : une commande peut inscrire à des ouvertures de deux
 * années différentes. La rattacher aux deux la compterait deux fois dans les
 * totaux ; on la rattache à la première, ce qui est déterministe et ne double
 * jamais un montant.
 *
 * CE QUE ÇA CHANGE POUR LE LECTEUR
 *
 * « Encaissements de l'année 2023-2024 » ne veut plus dire « argent enregistré
 * entre ces deux dates » mais « argent des classes ouvertes cette année-là ».
 * C'est la lecture qu'attend un fondateur, et la seule possible tant que les
 * horodatages ne distinguent pas les exercices. Les libellés des indicateurs le
 * disent.
 *
 * Colonnes produites par `pro_order_dates` :
 *   order_id — `professional_orders.id`
 *   debut    — date de début de la plus ancienne ouverture de la commande
 *
 * Paramètre attendu : `$1` = tenant.
 */
export const PRO_ORDER_DATES_CTE = `
  pro_order_dates AS (
    SELECT po.id AS order_id,
           MIN(s.date_debut) AS debut
      FROM professional_orders po
      JOIN professional_enrollments pe
        ON pe.order_id = po.id AND pe.tenant_id = po.tenant_id
      JOIN professional_ue_sessions s
        ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
     WHERE po.tenant_id = $1::uuid
       AND s.date_debut IS NOT NULL
     GROUP BY po.id
  )`;

/**
 * NOM DE CLASSE porté par une ouverture — règle des écrans admin.
 *
 * Les pages Paiements et Étudiants inscrits n'affichent pas `libelle` tel quel :
 * elles en retirent le suffixe « — CODE UE », de sorte que les quatre ouvertures
 * « MASTER 2 … — M2IA-S1-UE1 … UE4 » se rangent sous une seule classe. C'est
 * cette chaîne-là qu'elles filtrent, et non la filière : une filière peut porter
 * plusieurs classes (« LICENCE 1 TRANSPORT LOGISTIQUE » et « … B » existent sur
 * la même). La transcription SQL suit le JavaScript au caractère près, tirets
 * cadratin et demi-cadratin compris, sans quoi le propriétaire et
 * l'administration proposeraient deux listes pour la même école.
 *
 * Le repli sur `libelle` couvre le libellé réduit au seul code : le rogner
 * laisserait une chaîne vide, donc une classe sans nom.
 *
 * Alias attendus : `s` = professional_ue_sessions, `ue` = professional_ue.
 */
export const NOM_DE_CLASSE_SQL = `CASE
    WHEN COALESCE(ue.code, '') <> '' AND s.libelle LIKE '%' || ue.code
    THEN COALESCE(
           NULLIF(btrim(left(s.libelle, length(s.libelle) - length(ue.code)),
                        ' ' || chr(8212) || chr(8211) || '-'), ''),
           s.libelle)
    ELSE s.libelle
  END`;

/** Clé de sélection d'une classe, « filiereId|nom » — celle de la page Paiements. */
export const CLE_NOM_DE_CLASSE_SQL = `(ue.filiere_id::text || '|' || ${NOM_DE_CLASSE_SQL})`;

/**
 * Millésime « AAAA-AAAA+1 » d'une date de début d'ouverture, pivot septembre.
 *
 * Même règle que `/owner/stats/filters` et que la fenêtre du pouls : juillet et
 * août appartiennent à l'année qui s'achève. À paramétrer avec l'expression de
 * date à évaluer, par exemple `anneeDe("d.debut")`.
 */
export function anneeDe(expr: string): string {
  return `(CASE WHEN EXTRACT(MONTH FROM ${expr}) >= 9
                THEN EXTRACT(YEAR FROM ${expr})::int
                ELSE EXTRACT(YEAR FROM ${expr})::int - 1 END::text
           || '-' ||
           CASE WHEN EXTRACT(MONTH FROM ${expr}) >= 9
                THEN EXTRACT(YEAR FROM ${expr})::int + 1
                ELSE EXTRACT(YEAR FROM ${expr})::int END::text)`;
}
