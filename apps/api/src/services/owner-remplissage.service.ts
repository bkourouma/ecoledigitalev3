import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerRemplissageQuery,
  OwnerRemplissageResponse,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { anneeDe } from "./owner-pro-annee.sql";
import { OUVERTURES_CTE, OUVERTURES_PERIMETRE_CTE } from "./owner-perimetre.sql";

/**
 * Remplissage et planning.
 *
 * Deuxième question d'un propriétaire, après l'argent : « est-ce que les
 * effectifs tiennent, et est-ce que la machine est prête à tourner ? »
 *
 * Le paradoxe que cet écran corrige : `capacite_max` et l'effectif inscrit
 * transitent DÉJÀ dans les réponses d'API que consomme l'administration, et ne
 * sont affichés nulle part. On décide donc d'ouvrir ou de fermer une cohorte
 * sans jamais voir son taux de remplissage — alors qu'une cohorte vide
 * immobilise une salle, un enseignant et une ligne de planning.
 *
 * Quatre lectures :
 *
 *   1. REMPLISSAGE des cohortes professionnelles, trié par risque croissant :
 *      ce qu'il faut arbitrer avant la date de début ;
 *   2. CONFLITS de planning — même salle ou même enseignant sur deux créneaux
 *      qui se chevauchent. Rien ne les détecte aujourd'hui, ni à la saisie ni
 *      après : le conflit se découvre en salle, devant les étudiants ;
 *   3. COMPLÉTUDE du planning : créneaux sans salle, sans enseignant, et part
 *      des ECUE d'un semestre qui n'ont toujours pas d'horaire. C'est
 *      l'indicateur « prêt pour la rentrée », qui doit atteindre zéro à J-7 ;
 *   4. ÉCART entre les heures planifiées et les heures réellement tenues, qui
 *      mesure le respect du programme.
 *
 * PÉRIMÈTRE — corrigé.
 *
 * L'écran ne montrait que les ouvertures ni terminées ni annulées : 4 sur 64.
 * Les quatre appartenaient à la même filière et au même semestre, si bien que
 * « taux de remplissage des cohortes : 80 % » décrivait une promotion et se
 * lisait comme l'indicateur de l'établissement. Quatre années entières — 12
 * ouvertures chacune — restaient hors de portée.
 *
 * Le statut ne décide donc plus du périmètre : l'ANNÉE le décide, et le statut
 * ne sert plus qu'au tri et au compte des cohortes encore ouvertes. Une année
 * passée devient consultable, l'année en cours garde ses arbitrages en tête.
 *
 * CE QUI A ÉTÉ RETIRÉ — le bloc « Classes scolaires ».
 *
 * Six classes, un effectif de 0 pour chacune, et un indicateur « remplissage
 * des classes » figé à 0 %. Il lisait student_enrollments, table sans aucune
 * ligne : ce 0 % n'était pas un constat mais une absence de saisie affichée
 * comme un échec. Même retrait que la balance âgée et que l'onglet scolaire
 * d'Impayés — la moitié scolaire de cette base n'est pas alimentée.
 *
 * CE QUI A ÉTÉ ÉTENDU — le filtre au planning.
 *
 * Conflits, complétude des créneaux et heures ne recevaient que le tenant :
 * sur douze indicateurs, dix restaient figés quand on choisissait une filière.
 * Tous prennent maintenant le même périmètre que les cohortes.
 */

/* --------------------------------- Outils --------------------------------- */

type Row = Record<string, unknown>;

async function safeRows<T extends Row>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const res = await client.query<T>(sql, params);
    return res.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner remplissage query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Taux en %, `null` quand la capacité n'est pas renseignée — pas 0. */
function rate(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return round1((100 * part) / whole);
}

/** Nombre de lignes détaillées renvoyées par tableau. */
const ROWS_LIMIT = 100;

/**
 * Deux créneaux se chevauchent quand ils tombent le même jour de semaine, que
 * leurs plages horaires se croisent ET que leurs périodes de validité se
 * recouvrent. Oublier la troisième condition ferait remonter comme conflit deux
 * cours qui se succèdent sur deux semestres différents.
 */
const OVERLAP_CONDITION = `
  b.jour = a.jour
  AND a.heure_debut < b.heure_fin
  AND b.heure_debut < a.heure_fin
  AND COALESCE(a.date_debut, '-infinity'::date) <= COALESCE(b.date_fin, 'infinity'::date)
  AND COALESCE(b.date_debut, '-infinity'::date) <= COALESCE(a.date_fin, 'infinity'::date)`;

/**
 * Restriction d'un créneau d'emploi du temps à l'année et aux filières.
 *
 * Un créneau n'a pas d'année propre : il la tient de l'ouverture qu'il dessert.
 * On passe donc par la session, comme pour les cohortes — sans quoi « conflits
 * de planning » compterait les collisions de cinq années à la fois.
 *
 * Les alias internes sont préfixés : la même condition s'applique à des tables
 * déjà nommées `s` ou `u` — les séances, par exemple — et un alias partagé se
 * ferait masquer par celui de la sous-requête, qui se comparerait alors à
 * elle-même.
 *
 * $2 = année (text | null), $3 = filières (uuid[] | null).
 */
const CRENEAU_PERIMETRE = `
  EXISTS (
    SELECT 1
      FROM ouvertures_perimetre perim_op
     WHERE perim_op.ue_session_id = %ALIAS%.ue_session_id
  )`;

/** `CRENEAU_PERIMETRE` appliqué à un alias de table donné. */
function perimetreCreneau(alias: string): string {
  return CRENEAU_PERIMETRE.split("%ALIAS%").join(alias);
}

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function hhmm(v: unknown): string {
  const s = String(v ?? "");
  return s.slice(0, 5);
}

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerRemplissage(
  pool: Pool,
  tenantId: string,
  query: OwnerRemplissageQuery,
  log: FastifyBaseLogger
): Promise<OwnerRemplissageResponse> {
  const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
  const anneeScolaire = query.anneeScolaire ?? null;
  // Ordre figé pour toutes les requêtes de l'écran : tenant, année, filières.
  // Un ordre unique évite les décalages de $N au fil des retouches.
  /*
     Ce service numérotait déjà [tenant, année, filières] : il suffit de le
     compléter pour qu'il suive le contrat de owner-perimetre.sql, et il gagne
     au passage le filtre par ouverture de classe et par semestre — deux
     dimensions que son écran affiche pourtant.
  */
  const nomClasse = query.nomClasse?.trim() ? query.nomClasse.trim() : null;
  const semestreId = query.semestreId ?? null;
  const scopeParams = [tenantId, anneeScolaire, filiereIds, nomClasse, semestreId];
  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Cohortes professionnelles --------------------------------------- */
    // Périmètre : l'ANNÉE, pas le statut. Les annulées restent exclues — elles
    // n'ont jamais eu de remplissage à mesurer — mais les terminées entrent :
    // sans elles, quatre années d'ouvertures n'existaient nulle part.
    const cohorteRows = await safeRows<Row>(
      client,
      `WITH ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE}
       SELECT
         s.id, s.libelle, s.date_debut::text AS date_debut_iso, s.date_fin::text AS date_fin_iso,
         s.statut,
         s.capacite_max,
         u.code AS ue_code, u.libelle AS ue_libelle,
         u.filiere_id,
         pr.name AS filiere_name,
         (s.date_debut - CURRENT_DATE) AS jours_avant_debut,
         (SELECT COUNT(*) FROM professional_enrollments pe
           WHERE pe.ue_session_id = s.id
             AND pe.tenant_id = s.tenant_id
             AND pe.statut <> 'annulee')::int AS inscrits,
         /* L OUVERTURE COMME LIGNE ECONOMIQUE.
            Attendu : la somme des prix d inscription reellement poses sur
            cette ouverture — et non le prix catalogue de l UE, qui ignorerait
            les remises accordees a l inscription. */
         (SELECT COALESCE(SUM(pe.prix_unitaire), 0) FROM professional_enrollments pe
           WHERE pe.ue_session_id = s.id
             AND pe.tenant_id = s.tenant_id
             AND pe.statut <> 'annulee')::float8 AS ca_attendu,
         /* Encaisse : les reglements confirmes des commandes qui financent
            cette ouverture. Une commande peut en financer plusieurs — son
            montant est donc reparti au prorata du nombre d inscriptions
            qu elle porte, faute de quoi la premiere ouverture rencontree
            absorberait tout le reglement. */
         (SELECT COALESCE(SUM(pay.montant * pe_part.part), 0)
            FROM professional_enrollments pe
            JOIN professional_orders o
              ON o.id = pe.order_id AND o.tenant_id = pe.tenant_id
            JOIN professional_payments pay
              ON pay.order_id = o.id AND pay.tenant_id = o.tenant_id
             AND pay.statut = 'confirme'
            CROSS JOIN LATERAL (
              SELECT 1.0 / NULLIF((SELECT COUNT(*) FROM professional_enrollments pe2
                                    WHERE pe2.order_id = o.id
                                      AND pe2.tenant_id = o.tenant_id
                                      AND pe2.statut <> 'annulee'), 0) AS part
            ) pe_part
           WHERE pe.ue_session_id = s.id
             AND pe.tenant_id = s.tenant_id
             AND pe.statut <> 'annulee')::float8 AS ca_encaisse,
         /* Cout enseignant : le chemin est direct — payment_hour_details.seance_id
            puis professional_ecue_seances.ue_session_id — mais la table peut
            etre vide. NULL alors, jamais zero : voir couvertureEconomique. */
         (SELECT SUM(phd.amount)
            FROM payment_hour_details phd
            JOIN professional_ecue_seances sc ON sc.id = phd.seance_id
           WHERE sc.ue_session_id = s.id
             AND sc.tenant_id = s.tenant_id)::float8 AS cout_enseignant
       FROM professional_ue_sessions s
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       LEFT JOIN programmes pr ON pr.id = u.filiere_id AND pr.tenant_id = u.tenant_id
       WHERE s.tenant_id = $1::uuid
         AND s.statut <> 'annule'
         /* Périmètre commun : filière, année, CLASSE et semestre d'un coup. */
         AND EXISTS (SELECT 1 FROM ouvertures_perimetre op WHERE op.ue_session_id = s.id)
       ORDER BY s.date_debut DESC NULLS LAST
       LIMIT ${ROWS_LIMIT}`,
      scopeParams,
      log,
      "cohortes"
    );

    const cohortes = cohorteRows
      .map((r) => {
        const capacite = r.capacite_max === null ? null : Math.round(num(r.capacite_max));
        const inscrits = Math.round(num(r.inscrits));
        return {
          sessionId: String(r.id),
          libelle: String(r.libelle ?? ""),
          ueCode: String(r.ue_code ?? ""),
          ueLibelle: String(r.ue_libelle ?? ""),
          filiereName: (r.filiere_name as string | null) ?? null,
          statut: String(r.statut ?? ""),
          dateDebut: r.date_debut_iso ? String(r.date_debut_iso).slice(0, 10) : null,
          dateFin: r.date_fin_iso ? String(r.date_fin_iso).slice(0, 10) : null,
          joursAvantDebut: r.jours_avant_debut === null ? null : Math.round(num(r.jours_avant_debut)),
          capacite,
          inscrits,
          tauxRemplissage: capacite ? rate(inscrits, capacite) : null,
          caAttendu: Math.round(num(r.ca_attendu)),
          caEncaisse: Math.round(num(r.ca_encaisse)),
          resteDu: Math.max(0, Math.round(num(r.ca_attendu)) - Math.round(num(r.ca_encaisse))),
          /* NULL et non 0 : une source vide n'est pas un coût nul, et un solde
             bâti dessus annoncerait une rentabilité qui n'a pas été mesurée. */
          coutEnseignant: r.cout_enseignant === null ? null : Math.round(num(r.cout_enseignant)),
          solde:
            r.cout_enseignant === null
              ? null
              : Math.round(num(r.ca_encaisse)) - Math.round(num(r.cout_enseignant)),
        };
      })
      // Ce qui appelle encore un arbitrage passe devant : une cohorte terminée
      // ne se remplit plus, quel que soit son taux. Puis le plus critique
      // d'abord — une cohorte vide qui démarre dans 3 jours passe avant une
      // cohorte à moitié pleine qui démarre dans 2 mois.
      .sort((a, b) => {
        const oa = a.statut === "termine" ? 1 : 0;
        const ob = b.statut === "termine" ? 1 : 0;
        if (oa !== ob) return oa - ob;
        const ra = a.tauxRemplissage ?? 999;
        const rb = b.tauxRemplissage ?? 999;
        if (ra !== rb) return ra - rb;
        return (a.joursAvantDebut ?? 9999) - (b.joursAvantDebut ?? 9999);
      });

    /* ---- Le coût enseignant est-il seulement mesurable ? ------------------- */
    /*
       Constat AVANT d'afficher quoi que ce soit, comme le veut la règle : si
       `payment_hour_details` ne porte aucune heure rattachée à une séance, le
       coût par ouverture n'existe pas — et on le DIT, au lieu de replier sur
       une répartition au prorata des filières, qui est précisément la clé
       inventée que ce chantier supprime ailleurs.

       La mesure porte sur toute la table et non sur le périmètre : « la source
       est-elle alimentée » reste la même question quel que soit le filtre.
    */
    const heuresRows = await safeRows<Row>(
      client,
      `SELECT COUNT(*)::int AS lignes,
              COUNT(seance_id)::int AS avec_seance
         FROM payment_hour_details`,
      [],
      log,
      "couvertureHeures"
    );
    const heures = heuresRows[0] ?? {};
    const lignesHeures = Math.round(num(heures.lignes));
    const heuresRattachees = Math.round(num(heures.avec_seance));
    const coutEnseignantMesure = heuresRattachees > 0;

    /* ---- Conflits de planning --------------------------------------------- */
    // `b.id > a.id` : sans cette borne, chaque conflit remonterait deux fois,
    // une fois dans chaque sens.
    const conflitRows = await safeRows<Row>(
      client,
      `WITH ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE}
       SELECT
         a.id AS a_id, b.id AS b_id,
         CASE WHEN a.classroom_id IS NOT NULL AND a.classroom_id = b.classroom_id
              THEN 'salle' ELSE 'enseignant' END AS type,
         a.jour,
         a.heure_debut AS a_debut, a.heure_fin AS a_fin,
         b.heure_debut AS b_debut, b.heure_fin AS b_fin,
         cr.name AS classroom_name,
         TRIM(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) AS teacher_name,
         ea.libelle AS ecue_a, eb.libelle AS ecue_b,
         ua.code AS ue_a, ub.code AS ue_b
       FROM professional_emploi_temps a
       JOIN professional_emploi_temps b
         ON b.tenant_id = a.tenant_id
        AND b.id > a.id
        AND ${OVERLAP_CONDITION}
        AND (
          (a.classroom_id IS NOT NULL AND a.classroom_id = b.classroom_id)
          OR (a.enseignant_id IS NOT NULL AND a.enseignant_id = b.enseignant_id)
        )
       LEFT JOIN classrooms cr ON cr.id = a.classroom_id AND cr.tenant_id = a.tenant_id
       LEFT JOIN teachers t ON t.id = a.enseignant_id AND t.tenant_id = a.tenant_id
       LEFT JOIN professional_ecue ea ON ea.id = a.ecue_id AND ea.tenant_id = a.tenant_id
       LEFT JOIN professional_ecue eb ON eb.id = b.ecue_id AND eb.tenant_id = b.tenant_id
       LEFT JOIN professional_ue_sessions sa ON sa.id = a.ue_session_id AND sa.tenant_id = a.tenant_id
       LEFT JOIN professional_ue ua ON ua.id = sa.ue_id AND ua.tenant_id = sa.tenant_id
       LEFT JOIN professional_ue_sessions sb ON sb.id = b.ue_session_id AND sb.tenant_id = b.tenant_id
       LEFT JOIN professional_ue ub ON ub.id = sb.ue_id AND ub.tenant_id = sb.tenant_id
       WHERE a.tenant_id = $1::uuid
         AND ${perimetreCreneau("a")}
         AND ${perimetreCreneau("b")}
       ORDER BY a.jour, a.heure_debut
       LIMIT ${ROWS_LIMIT}`,
      scopeParams,
      log,
      "conflitsPlanning"
    );

    const conflits = conflitRows.map((r) => ({
      type: String(r.type) as "salle" | "enseignant",
      jour: JOURS[Math.round(num(r.jour))] ?? String(r.jour),
      plageA: `${hhmm(r.a_debut)}–${hhmm(r.a_fin)}`,
      plageB: `${hhmm(r.b_debut)}–${hhmm(r.b_fin)}`,
      ressource:
        String(r.type) === "salle"
          ? ((r.classroom_name as string | null) ?? "Salle inconnue")
          : ((r.teacher_name as string | null)?.trim() || "Enseignant inconnu"),
      coursA: `${r.ue_a ?? "?"} · ${r.ecue_a ?? "ECUE inconnue"}`,
      coursB: `${r.ue_b ?? "?"} · ${r.ecue_b ?? "ECUE inconnue"}`,
    }));

    /* ---- Complétude du planning ------------------------------------------- */
    const gapRows = await safeRows<Row>(
      client,
      `WITH ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE}
       SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE classroom_id IS NULL)::int AS sans_salle,
         COUNT(*) FILTER (WHERE enseignant_id IS NULL)::int AS sans_enseignant
       FROM professional_emploi_temps et
       WHERE et.tenant_id = $1::uuid
         AND ${perimetreCreneau("et")}`,
      scopeParams,
      log,
      "creneauxIncomplets"
    );
    const gap = gapRows[0] ?? {};

    /* ---- Couverture du planning, par semestre ------------------------------ */
    // Le rattachement semestre → session emprunte les DEUX chemins existants
    // (par session et par UE), comme partout ailleurs dans le module.
    const couvertureRows = await safeRows<Row>(
      client,
      `WITH ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE},
       sem_sessions AS (
         SELECT DISTINCT sem.id AS semestre_id, sem.libelle, sem.filiere_id, s.id AS ue_session_id
         FROM professional_semestres sem
         JOIN professional_ue_sessions s
           ON s.tenant_id = sem.tenant_id
          AND (
            s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
            OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
          )
         WHERE sem.tenant_id = $1::uuid
           AND s.statut <> 'annule'
           /* Périmètre commun, comme partout ailleurs dans ce service. */
           AND EXISTS (SELECT 1 FROM ouvertures_perimetre op WHERE op.ue_session_id = s.id)
       ),
       attendus AS (
         SELECT ss.semestre_id, ss.libelle, ss.filiere_id, ss.ue_session_id, l.ecue_id
         FROM sem_sessions ss
         JOIN professional_ue_sessions s ON s.id = ss.ue_session_id AND s.tenant_id = $1::uuid
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       )
       SELECT
         a.semestre_id, a.libelle,
         pr.name AS filiere_name,
         COUNT(*)::int AS ecue_total,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM professional_emploi_temps et
            WHERE et.tenant_id = $1::uuid
              AND et.ue_session_id = a.ue_session_id
              AND et.ecue_id = a.ecue_id
         ))::int AS ecue_programmees
       FROM attendus a
       LEFT JOIN programmes pr ON pr.id = a.filiere_id AND pr.tenant_id = $1::uuid
       GROUP BY a.semestre_id, a.libelle, pr.name
       ORDER BY pr.name NULLS LAST, a.libelle
       LIMIT ${ROWS_LIMIT}`,
      scopeParams,
      log,
      "couverturePlanning"
    );

    const couverture = couvertureRows.map((r) => {
      const total = Math.round(num(r.ecue_total));
      const programmees = Math.round(num(r.ecue_programmees));
      return {
        semestreId: String(r.semestre_id),
        libelle: String(r.libelle ?? ""),
        filiereName: (r.filiere_name as string | null) ?? null,
        ecueTotal: total,
        ecueProgrammees: programmees,
        taux: rate(programmees, total),
      };
    });

    /* ---- Écart entre planifié et tenu, sur le périmètre -------------------- */
    // On déroule le calendrier de la fenêtre et on compte, pour chaque créneau
    // hebdomadaire, ses occurrences réellement tombées dans sa période de
    // validité. Comparer une grille hebdomadaire à un volume sans ce déroulé
    // donnerait n'importe quoi.
    //
    // LA FENÊTRE EST CELLE DE L'ÉCRAN, plus les 30 derniers jours. Cette fenêtre
    // glissante ne couvrait que 24 des 1 326 séances tenues : « respect du
    // planning 92,3 % » décrivait deux semaines d'été et ne bougeait ni avec la
    // filière ni avec l'année. Sans année choisie, la fenêtre s'étend sur toute
    // la période couverte par les créneaux du périmètre.
    const ecartRows = await safeRows<Row>(
      client,
      `WITH ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE},
       bornes AS (
         SELECT
           COALESCE(
             CASE WHEN $2::text IS NULL THEN NULL
                  ELSE make_date(split_part($2::text, '-', 1)::int, 9, 1) END,
             (SELECT MIN(et.date_debut) FROM professional_emploi_temps et
               WHERE et.tenant_id = $1::uuid AND ${perimetreCreneau("et")})
           ) AS d1,
           COALESCE(
             CASE WHEN $2::text IS NULL THEN NULL
                  ELSE make_date(split_part($2::text, '-', 1)::int + 1, 8, 31) END,
             (SELECT MAX(et.date_fin) FROM professional_emploi_temps et
               WHERE et.tenant_id = $1::uuid AND ${perimetreCreneau("et")})
           ) AS d2
       ),
       jours AS (
         -- Le garde-fou NOT NULL : sans aucun créneau au périmètre, les bornes
         -- sont nulles et generate_series lèverait une erreur.
         SELECT d::date AS d, EXTRACT(ISODOW FROM d)::int AS dow
         FROM bornes b, generate_series(b.d1, b.d2, INTERVAL '1 day') d
         WHERE b.d1 IS NOT NULL AND b.d2 IS NOT NULL
       ),
       planifie AS (
         SELECT COALESCE(SUM(
                  EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
                ), 0)::float8 AS h
         FROM professional_emploi_temps et
         JOIN jours j
           ON j.dow = et.jour
          AND j.d >= COALESCE(et.date_debut, j.d)
          AND j.d <= COALESCE(et.date_fin, j.d)
         WHERE et.tenant_id = $1::uuid
           AND et.heure_debut IS NOT NULL AND et.heure_fin IS NOT NULL
           AND ${perimetreCreneau("et")}
       ),
       tenu AS (
         SELECT COALESCE(SUM(
                  EXTRACT(EPOCH FROM (sea.heure_fin - sea.heure_debut)) / 3600.0
                ), 0)::float8 AS h,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE sea.heure_debut IS NULL OR sea.heure_fin IS NULL)::int AS n_sans_horaire
         FROM professional_ecue_seances sea, bornes b
         WHERE sea.tenant_id = $1::uuid
           AND (b.d1 IS NULL OR sea.date >= b.d1)
           AND (b.d2 IS NULL OR sea.date <= b.d2)
           AND ${perimetreCreneau("sea")}
       )
       SELECT planifie.h AS planifie, tenu.h AS tenu, tenu.n AS seances, tenu.n_sans_horaire AS sans_horaire
       FROM planifie, tenu`,
      scopeParams,
      log,
      "ecartPlanifieTenu"
    );
    const ecart = ecartRows[0] ?? {};
    const heuresPlanifiees = round1(num(ecart.planifie));
    const heuresTenues = round1(num(ecart.tenu));

    /* ---- Totaux ------------------------------------------------------------ */
    const capaciteCohortes = cohortes.reduce((s, c) => s + (c.capacite ?? 0), 0);
    const inscritsCohortes = cohortes
      .filter((c) => c.capacite !== null)
      .reduce((s, c) => s + c.inscrits, 0);
    return {
      computedAt: new Date().toISOString(),
      anneeScolaire,
      kpis: {
        cohortesActives: cohortes.length,
        cohortesVides: cohortes.filter((c) => c.inscrits === 0).length,
        cohortesSansCapacite: cohortes.filter((c) => c.capacite === null).length,
        tauxRemplissageCohortes: rate(inscritsCohortes, capaciteCohortes),
        cohortesOuvertes: cohortes.filter((c) => c.statut !== "termine").length,
        conflitsPlanning: conflits.length,
        creneauxTotal: Math.round(num(gap.total)),
        creneauxSansSalle: Math.round(num(gap.sans_salle)),
        creneauxSansEnseignant: Math.round(num(gap.sans_enseignant)),
        heuresPlanifiees,
        heuresTenues,
        tauxRespectPlanning: rate(heuresTenues, heuresPlanifiees),
        seancesSansHoraire: Math.round(num(ecart.sans_horaire)),
      },
      cohortes,
      conflits,
      couvertureEconomique: {
        coutEnseignantMesure,
        raison: coutEnseignantMesure
          ? null
          : lignesHeures === 0
            ? "Aucune heure de paie n'est enregistrée : le coût par ouverture n'est pas mesurable. Il n'est pas remplacé par une répartition au prorata, qui inventerait une clé."
            : `Les ${lignesHeures} lignes d'heures de paie ne sont rattachées à aucune séance : le coût ne peut être imputé à une ouverture.`,
        ouverturesValorisees: cohortes.filter((c) => c.caAttendu > 0).length,
      },
      couverture,
    };
  } finally {
    client.release();
  }
}

/** Export CSV du remplissage des cohortes et des conflits de planning. */
export function buildOwnerRemplissageCsv(data: OwnerRemplissageResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const pct = (v: number | null) => (v === null ? "capacité non renseignée" : String(v));
  const lines: string[] = [];

  // Le périmètre en tête : un CSV se relit hors de l'écran qui l'a produit.
  lines.push(`Périmètre;${data.anneeScolaire ?? "toutes années cumulées"}`);
  lines.push("");

  lines.push("Cohortes professionnelles");
  lines.push("Filière;UE;Session;Statut;Début;Jours avant début;Inscrits;Capacité;Remplissage %");
  for (const c of data.cohortes) {
    lines.push(
      [
        esc(c.filiereName ?? ""),
        esc(c.ueCode),
        esc(c.libelle),
        esc(c.statut),
        c.dateDebut ?? "",
        c.joursAvantDebut ?? "",
        c.inscrits,
        c.capacite ?? "",
        pct(c.tauxRemplissage),
      ].join(";")
    );
  }

  lines.push("");
  lines.push("Conflits de planning");
  lines.push("Type;Ressource;Jour;Plage A;Cours A;Plage B;Cours B");
  for (const c of data.conflits) {
    lines.push(
      [
        c.type === "salle" ? "Salle" : "Enseignant",
        esc(c.ressource),
        c.jour,
        c.plageA,
        esc(c.coursA),
        c.plageB,
        esc(c.coursB),
      ].join(";")
    );
  }

  return lines.join("\n");
}
