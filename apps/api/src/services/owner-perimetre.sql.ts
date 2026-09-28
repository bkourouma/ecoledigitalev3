import { NOM_DE_CLASSE_SQL, CLE_NOM_DE_CLASSE_SQL, anneeDe } from "./owner-pro-annee.sql";

/**
 * Périmètre commun de l'espace propriétaire : année scolaire × ouverture de classe.
 *
 * CE QU'IL RÉSOUT
 *
 * Chaque service owner refaisait son propre filtrage, avec sa propre numérotation
 * de paramètres et sa propre idée de ce qu'est « appartenir à une classe ». Trois
 * conséquences mesurées sur cette base :
 *
 *   - le filtre « ouverture de classe » n'était honoré que par un seul écran, et
 *     à moitié : sur Impayés, choisir une classe restreignait le haut de la page
 *     et pas le bas, faute d'un paramètre que l'autre requête ne connaissait pas ;
 *   - les CTE de périmètre passaient tous par professional_enrollments, si bien
 *     que poser un filtre de classe effaçait les commandes de FRAIS — celles qui
 *     n'inscrivent à aucune UE. Mesuré : 690 000 FCFA sur 960 000 ;
 *   - aucun écran ne savait produire l'année précédente.
 *
 * LE CONTRAT DE PARAMÈTRES, ET POURQUOI IL EST FIGÉ
 *
 * Un fragment SQL partagé n'est réutilisable que si ses paramètres sont toujours
 * aux mêmes places. owner-finances-pro a dû ajouter le nom de classe en $6 après
 * coup ; à la requête suivante, plus personne ne pouvait réutiliser son CTE. On
 * fige donc, pour TOUTE requête qui consomme ces fragments :
 *
 *     $1  tenantId       uuid
 *     $2  anneeScolaire  text     NULL = toutes les années
 *     $3  filiereIds     uuid[]   NULL = toutes les filières
 *     $4  nomClasse      text     NULL = toutes les classes  (cle "filiereId|nom")
 *     $5  semestreId     uuid     NULL = tous les semestres
 *
 * Les paramètres propres à un écran commencent à $6.
 *
 * Postgres exige de pouvoir typer chaque $n cité. Un fragment qui n'utilise pas
 * un paramètre du contrat doit quand même le citer pour que la requête compile —
 * d'où les tests d'apparence inutile que pratique déjà le pouls.
 */

/** Paramètres du contrat, dans l'ordre, pour construire un tableau d'arguments. */
export type PerimetreParams = {
  tenantId: string;
  anneeScolaire?: string | null;
  filiereIds?: string[] | null;
  nomClasse?: string | null;
  semestreId?: string | null;
};

/**
 * Les cinq paramètres du contrat, prêts à être passés à pg.
 *
 * Un tableau vide vaut « pas de filtre » et non « aucune filière » : c'est la
 * convention de normalizeStatsQuery, qui traite une chaîne vide comme un filtre
 * absent. La respecter ici évite qu'un écran affiche zéro parce que l'utilisateur
 * vient de décocher la dernière case.
 */
export function perimetreArgs(p: PerimetreParams): unknown[] {
  return [
    p.tenantId,
    p.anneeScolaire ?? null,
    p.filiereIds && p.filiereIds.length > 0 ? p.filiereIds : null,
    p.nomClasse ?? null,
    p.semestreId ?? null,
  ];
}

/**
 * Millésime de l'année précédente, dérivé du paramètre $2.
 *
 * NULL quand aucune année n'est demandée : comparer « toutes les années » à
 * « toutes les années moins une » ne veut rien dire, et le service doit alors
 * annoncer la comparaison comme non mesurée plutôt que d'en fabriquer une.
 */
export const ANNEE_PRECEDENTE_SQL = `
  (CASE WHEN $2::text IS NULL THEN NULL
        ELSE (split_part($2::text, '-', 1)::int - 1)::text || '-' ||
             (split_part($2::text, '-', 2)::int - 1)::text END)`;

/**
 * Toutes les ouvertures de classe du tenant, nommées et datées.
 *
 * C'est le pivot : une ouverture porte la date qui fait foi (date_debut), le nom
 * de classe des écrans d'administration, et le millésime qui en découle. Tout le
 * reste du périmètre se lit depuis elle.
 *
 * Les ouvertures sans date de début sont écartées : elles ne se rattachent à
 * aucune année, et les faire entrer dans un filtre d'année affirmerait un
 * rattachement qu'on n'a pas.
 *
 * Colonnes : ue_session_id, ue_id, filiere_id, date_debut, date_fin, nom_classe,
 * cle_classe, annee.
 */
export const OUVERTURES_CTE = `
  ouvertures AS (
    SELECT s.id                         AS ue_session_id,
           s.ue_id,
           ue.filiere_id,
           s.date_debut,
           s.date_fin,
           ${NOM_DE_CLASSE_SQL}         AS nom_classe,
           ${CLE_NOM_DE_CLASSE_SQL}     AS cle_classe,
           ${anneeDe("s.date_debut")}   AS annee
      FROM professional_ue_sessions s
      JOIN professional_ue ue
        ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1::uuid
       AND s.date_debut IS NOT NULL
  )`;

/**
 * Les ouvertures retenues par les filtres de l'écran.
 *
 * Le semestre passe par SES DEUX CHEMINS — rattachement par session et par UE.
 * Les services de notes, de bulletins et de présences le font tous ; ne suivre
 * que le premier proposerait, dans le sélecteur, des semestres que le filtre ne
 * retrouverait jamais.
 *
 * Dépend de OUVERTURES_CTE, à déclarer avant lui dans le WITH.
 */
export const OUVERTURES_PERIMETRE_CTE = `
  ouvertures_perimetre AS (
    SELECT o.*
      FROM ouvertures o
     WHERE ($2::text   IS NULL OR o.annee = $2::text)
       AND ($3::uuid[] IS NULL OR o.filiere_id = ANY($3::uuid[]))
       AND ($4::text   IS NULL OR o.cle_classe = $4::text)
       AND ($5::uuid   IS NULL
            OR EXISTS (SELECT 1 FROM professional_semestre_sessions ss
                        WHERE ss.tenant_id = $1::uuid
                          AND ss.ue_session_id = o.ue_session_id
                          AND ss.semestre_id = $5::uuid)
            OR EXISTS (SELECT 1 FROM professional_semestre_ue su
                        WHERE su.tenant_id = $1::uuid
                          AND su.ue_id = o.ue_id
                          AND su.semestre_id = $5::uuid))
  )`;

/**
 * Les commandes du périmètre — DEUX SORTES, et c'est tout l'enjeu.
 *
 * Une commande d'UE appartient au périmètre par ses inscriptions. Une commande
 * de FRAIS — inscription, scolarité, annexes, autres, depuis les migrations 0122
 * et 0123 — n'inscrit à rien : elle n'a aucune ligne dans
 * professional_enrollments, et tout prédicat qui passe par cette table l'efface.
 * Elle porte en revanche sa classe, et se rattache par elle.
 *
 * La seconde branche n'est donc pas un rattrapage approximatif : c'est la donnée
 * que la commande porte elle-même. Son appartenance se lit sur les ouvertures de
 * SA classe, ce qui la range exactement où la range pro_order_dates.
 *
 * Les commandes annulées sont hors périmètre : elles ne sont ni attendues ni
 * dues. Le statut « payee », lui, ne prouve aucun encaissement et ne filtre rien
 * ici — l'encaissé se lit sur professional_payments, jamais sur la commande.
 *
 * Dépend de OUVERTURES_PERIMETRE_CTE.
 * Colonnes : order_id, student_id, montant_total, programme_id, nature,
 * par_inscription.
 */
export const COMMANDES_PERIMETRE_CTE = `
  commandes_perimetre AS (
    SELECT o.id                     AS order_id,
           o.student_id,
           o.montant_total::float8  AS montant_total,
           o.programme_id,
           o.nature,
           TRUE                     AS par_inscription
      FROM professional_orders o
     WHERE o.tenant_id = $1::uuid
       AND o.statut <> 'annulee'
       AND EXISTS (
         SELECT 1
           FROM professional_enrollments en
           JOIN ouvertures_perimetre op ON op.ue_session_id = en.ue_session_id
          WHERE en.order_id = o.id
            AND en.tenant_id = o.tenant_id
            AND en.statut <> 'annulee')
    UNION ALL
    SELECT o.id, o.student_id, o.montant_total::float8, o.programme_id, o.nature, FALSE
      FROM professional_orders o
     WHERE o.tenant_id = $1::uuid
       AND o.statut <> 'annulee'
       AND o.programme_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM professional_enrollments en
          WHERE en.order_id = o.id AND en.tenant_id = o.tenant_id
            AND en.statut <> 'annulee')
       AND EXISTS (
         SELECT 1 FROM ouvertures_perimetre op
          WHERE op.filiere_id = o.programme_id)
  )`;

/**
 * Les étudiants du périmètre, avec la classe par laquelle ils y entrent.
 *
 * Un étudiant peut relever de plusieurs classes et de plusieurs années : le
 * fragment produit une ligne par couple, et c'est à l'appelant de faire son
 * COUNT(DISTINCT student_id) s'il veut un effectif. Agréger ici à sa place
 * l'obligerait à défaire l'agrégat dès qu'il veut ventiler.
 *
 * Dépend de OUVERTURES_PERIMETRE_CTE.
 */
export const ETUDIANTS_PERIMETRE_CTE = `
  etudiants_perimetre AS (
    SELECT DISTINCT
           en.student_id,
           op.filiere_id,
           op.cle_classe,
           op.nom_classe,
           op.annee
      FROM professional_enrollments en
      JOIN ouvertures_perimetre op ON op.ue_session_id = en.ue_session_id
     WHERE en.tenant_id = $1::uuid
       AND en.statut <> 'annulee'
  )`;

/**
 * Le socle complet, dans l'ordre de dépendance, prêt à suivre un WITH.
 *
 * Réservé aux requêtes qui les utilisent tous : un CTE déclaré et jamais lu
 * reste à la charge du planificateur.
 */
export const PERIMETRE_CTE = [
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  COMMANDES_PERIMETRE_CTE,
  ETUDIANTS_PERIMETRE_CTE,
].join(",\n");
