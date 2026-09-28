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
 * LES COMMANDES QUI N'INSCRIVENT À RIEN
 *
 * Depuis les migrations 0122 et 0123, `professional_orders` porte aussi des
 * commandes de FRAIS — inscription, scolarité, frais annexes, autres — qui ne
 * financent aucune ouverture et n'ont donc AUCUNE ligne dans
 * `professional_enrollments`. Deux JOIN internes les faisaient disparaître :
 * mesuré sur la base de développement, 690 000 FCFA sur 960 000, soit 72 % des
 * montants, sortaient du périmètre dès qu'une année ou une classe était
 * choisie. L'écran annonçait « 2026-2027 » et montrait le quart de la vérité.
 *
 * D'où une cascade de replis, du plus précis au plus grossier, et un
 * `CROSS JOIN LATERAL` qui ne perd jamais une commande :
 *
 *   1. les ouvertures que la commande finance ;
 *   2. les ouvertures de SA classe (`programme_id`, migration 0122) où
 *      l'étudiant est inscrit — c'est ce niveau qui récupère les frais ;
 *   3. n'importe quelle ouverture où l'étudiant est inscrit ;
 *   4. les ouvertures de la classe portée par la commande ;
 *   5. à défaut, la date d'écriture de la ligne.
 *
 * `niveau` SORT DE LA REQUÊTE, et ce n'est pas décoratif : un montant daté par
 * le niveau 5 est daté par défaut, pas mesuré. L'appelant qui l'affiche sans
 * le dire présente une approximation comme un fait. Les niveaux 1 et 2 sont
 * des rattachements pédagogiques ; les niveaux 4 et 5 sont des approximations.
 *
 * Colonnes produites par `pro_order_dates` :
 *   order_id — `professional_orders.id`
 *   debut    — date de début retenue pour la commande
 *   niveau   — 1 à 5, le rang du repli ayant fourni `debut` (cf. ci-dessus)
 *
 * Paramètre attendu : `$1` = tenant.
 */
export const PRO_ORDER_DATES_CTE = `
  pro_order_dates AS (
    SELECT po.id AS order_id,
           d.debut,
           d.niveau
      FROM professional_orders po
      /* LATERAL et non LEFT JOIN : le niveau 5 renvoie toujours une ligne, donc
         aucune commande ne sort du perimetre faute de date. C'est exactement le
         defaut que cette version corrige. */
      CROSS JOIN LATERAL (
        SELECT v.debut, v.niveau
          FROM (
            /* 1. Les ouvertures que cette commande finance. */
            SELECT MIN(s.date_debut) AS debut, 1 AS niveau
              FROM professional_enrollments en
              JOIN professional_ue_sessions s
                ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
             WHERE en.order_id = po.id AND en.tenant_id = po.tenant_id
            UNION ALL
            /* 2. Les ouvertures de SA classe ou l'etudiant est inscrit.
                  Le niveau qui recupere les commandes de frais. */
            SELECT MIN(s.date_debut), 2
              FROM professional_enrollments en
              JOIN professional_ue_sessions s
                ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
              JOIN professional_ue ue
                ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
             WHERE en.student_id = po.student_id AND en.tenant_id = po.tenant_id
               AND po.programme_id IS NOT NULL AND ue.filiere_id = po.programme_id
            UNION ALL
            /* 3. Toute ouverture ou l'etudiant est inscrit. */
            SELECT MIN(s.date_debut), 3
              FROM professional_enrollments en
              JOIN professional_ue_sessions s
                ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
             WHERE en.student_id = po.student_id AND en.tenant_id = po.tenant_id
            UNION ALL
            /* 4. Les ouvertures de la classe portee par la commande. */
            SELECT MIN(s.date_debut), 4
              FROM professional_ue_sessions s
              JOIN professional_ue ue
                ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
             WHERE po.programme_id IS NOT NULL AND ue.filiere_id = po.programme_id
               AND s.tenant_id = po.tenant_id
            UNION ALL
            /* 5. Dernier recours : la date d'ecriture de la ligne. Approximation
                  assumee, signalee par le niveau. */
            SELECT po.created_at::date, 5
          ) v
         WHERE v.debut IS NOT NULL
         ORDER BY v.niveau
         LIMIT 1
      ) d
     WHERE po.tenant_id = $1::uuid
  )`;

/**
 * Au-dela de ce rang, la date est une approximation et non un rattachement
 * pedagogique. A comparer a `pro_order_dates.niveau` pour distinguer, dans un
 * total, la part reellement datee de la part datee par defaut.
 */
export const PRO_DATE_NIVEAU_MESURE = 3;

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
