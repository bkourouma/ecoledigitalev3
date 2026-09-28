/**
 * Compte de résultat à deux colonnes : fragments SQL et bornes d'exercice.
 *
 * CE QUE CE FICHIER RÉSOUT
 *
 * L'écran Rentabilité ne savait dire qu'une chose : ce qui est encaissé, moins
 * ce qui est décaissé. C'est une vue de caisse, et elle suffit à un gérant ;
 * elle ne suffit pas au fondateur de cette école, qui est expert-comptable.
 * Lui lit un exercice en deux colonnes : ce que l'école a GAGNÉ, et ce qui est
 * PASSÉ par la banque. L'écart entre les deux n'est pas une anomalie à masquer,
 * c'est l'information : il se décompose en trois soldes de clôture.
 *
 * Les deux dates de chaque fait sont déjà en base, et c'est ce qui rend
 * l'exercice possible sans migration :
 *
 *   produits  — la commande est émise (engagement), le règlement est confirmé
 *               (caisse). L'écart est la CRÉANCE CLIENT.
 *   charges   — `expenses.incurred_on` (engagement), `expenses.paid_on`
 *               (caisse). L'écart est la DETTE FOURNISSEUR.
 *   salaires  — `teacher_payments.approved_at` (engagement), `paid_at`
 *               (caisse). L'écart est le SALAIRE DÛ.
 *
 * LA DATE DES PRODUITS, ET POURQUOI ELLE N'EST PAS CELLE DE L'ÉCRITURE
 *
 * Un compte de résultat borne un exercice par des dates. Or `created_at` et
 * `paid_at` des commandes professionnelles portent la date d'écriture de la
 * ligne, identique sur cinq années sur une base reprise — les borner
 * produirait un exercice vide et un autre gonflé de tout l'historique.
 * `pro_order_dates` fournit la seule date qui décrive un fait : le début de
 * l'ouverture financée. Les produits sont donc bornés par elle, exactement
 * comme le reste de l'espace propriétaire, et le libellé de l'écran le dit.
 *
 * LA CAISSE, ELLE, EST DATÉE AU VERSEMENT
 *
 * Une colonne « caisse » qui daterait les règlements à l'ouverture de la classe
 * ne serait pas une colonne de caisse. `professional_payments.paid_at` est ici
 * la bonne date : c'est le jour où l'argent est arrivé. Les deux colonnes ne se
 * recoupent donc pas ligne à ligne, et c'est normal — l'écran l'annonce.
 */

/** Base d'un exercice : l'année scolaire de l'école, ou l'année civile. */
export type BaseExercice = "scolaire" | "civil";

export type Exercice = {
  base: BaseExercice;
  debut: Date;
  fin: Date;
  libelle: string;
};

/**
 * Bornes de l'exercice, à partir du millésime affiché par la barre de filtres.
 *
 * `anneeScolaire` vaut « AAAA-AAAA+1 ». En base civile, on retient l'année
 * CIVILE D'OUVERTURE : un exercice 2026-2027 lu en civil est l'année 2026.
 *
 * Ce choix n'est pas arbitraire, il est le seul qui montre quelque chose. Les
 * classes d'un exercice scolaire ouvrent en septembre ou octobre, et c'est là
 * que tombent les frais d'inscription et le gros de la scolarité. Retenir
 * l'année de clôture — 2027 — donnerait un exercice qui commence APRÈS toutes
 * les ouvertures de l'exercice choisi : mesuré sur la base de développement,
 * 0 FCFA de produits contre 1 710 000 en année d'ouverture. Un comptable qui
 * bascule le sélecteur et voit zéro conclut à une panne, pas à une convention.
 *
 * Le libellé renvoyé dit l'année retenue, pour que le lecteur sache toujours
 * quel exercice il regarde.
 *
 * Sans millésime — la barre accepte « toutes années » —, l'exercice ne peut pas
 * être borné : l'appelant doit alors annoncer le compte de résultat comme non
 * mesurable plutôt que d'en inventer un sur douze mois glissants.
 */
export function bornesExercice(
  anneeScolaire: string | null,
  base: BaseExercice
): Exercice | null {
  if (!anneeScolaire) return null;
  const m = /^(\d{4})-(\d{4})$/.exec(anneeScolaire);
  if (!m) return null;
  const ouverture = Number(m[1]);
  const cloture = Number(m[2]);

  if (base === "civil") {
    return {
      base,
      debut: new Date(Date.UTC(ouverture, 0, 1)),
      fin: new Date(Date.UTC(ouverture, 11, 31, 23, 59, 59, 999)),
      libelle: `Année civile ${ouverture}`,
    };
  }
  /* Pivot septembre, celui de tout l'espace propriétaire. */
  return {
    base,
    debut: new Date(Date.UTC(ouverture, 8, 1)),
    fin: new Date(Date.UTC(cloture, 7, 31, 23, 59, 59, 999)),
    libelle: `Exercice scolaire ${anneeScolaire}`,
  };
}

/**
 * Produits : engagement et caisse, plus la créance qui les sépare.
 *
 * Dépend de `pro_order_dates` ET du socle de périmètre. Paramètres : les cinq
 * du contrat, puis $6 = début et $7 = fin de l'exercice.
 *
 * Les commandes de nature `transversal` sont exclues : elles portent la
 * conduite, qui traverse les classes sans être vendue. Les compter comme un
 * produit gonflerait le chiffre d'affaires d'une prestation jamais facturée.
 */
export const PRODUITS_EXERCICE_SQL = `
  SELECT
    (SELECT COALESCE(SUM(cp.montant_total), 0)
       FROM commandes_perimetre cp
       JOIN pro_order_dates d ON d.order_id = cp.order_id
      WHERE cp.nature IS DISTINCT FROM 'transversal'
        AND d.debut BETWEEN $6::date AND $7::date)::float8    AS engagement,
    (SELECT COALESCE(SUM(p.montant), 0)
       FROM professional_payments p
       JOIN commandes_perimetre cp ON cp.order_id = p.order_id
      WHERE p.tenant_id = $1::uuid
        AND p.statut = 'confirme'
        AND COALESCE(p.paid_at, p.created_at) BETWEEN $6::timestamptz
                                                  AND $7::timestamptz)::float8 AS caisse,
    /* Créance client : facturé sur l exercice, jamais encaisse a ce jour.
       Ce n est PAS engagement moins caisse — les deux colonnes ne sont pas
       datees de la meme facon, et leur difference melangerait un decalage de
       tresorerie avec un decalage de datation. */
    (SELECT COALESCE(SUM(cp.montant_total), 0)
       FROM commandes_perimetre cp
       JOIN pro_order_dates d ON d.order_id = cp.order_id
      WHERE cp.nature IS DISTINCT FROM 'transversal'
        AND d.debut BETWEEN $6::date AND $7::date)::float8
    - (SELECT COALESCE(SUM(p.montant), 0)
         FROM professional_payments p
         JOIN commandes_perimetre cp ON cp.order_id = p.order_id
         JOIN pro_order_dates d ON d.order_id = cp.order_id
        WHERE p.tenant_id = $1::uuid
          AND p.statut = 'confirme'
          AND d.debut BETWEEN $6::date AND $7::date)::float8  AS creances`;

/**
 * Charges externes : engagées, décaissées, et la dette qui reste.
 *
 * `nombre_engage` sert à distinguer « aucune charge » de « charges à zéro » :
 * sans lui, une comptabilité jamais saisie et une école sans dépense se
 * ressemblent trait pour trait.
 *
 * Le rattachement suit `ANNEE_CHARGE_SQL` pour l'exercice scolaire et les dates
 * brutes pour l'exercice civil — d'où deux jeux de bornes, et non un seul.
 */
export const CHARGES_EXERCICE_SQL = `
  SELECT
    COALESCE(SUM(e.amount) FILTER (
      WHERE e.incurred_on BETWEEN $2::date AND $3::date), 0)::float8   AS engagement,
    COALESCE(SUM(e.amount) FILTER (
      WHERE e.paid_on IS NOT NULL
        AND e.paid_on BETWEEN $2::date AND $3::date), 0)::float8       AS caisse,
    COUNT(*) FILTER (
      WHERE e.incurred_on BETWEEN $2::date AND $3::date)::int          AS nombre_engage,
    COALESCE(SUM(e.amount) FILTER (
      WHERE e.incurred_on BETWEEN $2::date AND $3::date
        AND e.paid_on IS NULL), 0)::float8                             AS dettes
    FROM expenses e
   WHERE e.tenant_id = $1::uuid`;

/**
 * Masse salariale enseignante : approuvée, versée, et le solde dû.
 *
 * `approved_at` est la date d'engagement : c'est la validation qui rend la paie
 * exigible, pas son calcul. Un bulletin calculé mais non approuvé n'engage
 * l'école à rien et n'entre donc dans aucune colonne.
 *
 * ⚠ La table peut être entièrement vide — c'est le cas sur la base de
 * développement au 22/09/2026. `nombre` permet à l'appelant de sortir la ligne
 * en `mesuree: false` au lieu d'afficher une masse salariale nulle, qui se
 * lirait « les enseignants ne coûtent rien ».
 */
export const SALAIRES_EXERCICE_SQL = `
  SELECT
    COALESCE(SUM(tp.total_amount) FILTER (
      WHERE tp.approved_at BETWEEN $2::timestamptz AND $3::timestamptz), 0)::float8 AS engagement,
    COALESCE(SUM(tp.total_amount) FILTER (
      WHERE tp.paid_at BETWEEN $2::timestamptz AND $3::timestamptz), 0)::float8     AS caisse,
    COUNT(*)::int                                                                   AS nombre,
    COALESCE(SUM(tp.total_amount) FILTER (
      WHERE tp.approved_at IS NOT NULL AND tp.paid_at IS NULL), 0)::float8          AS dus
    FROM teacher_payments tp
   WHERE tp.tenant_id = $1::uuid
     AND tp.archived_at IS NULL`;
