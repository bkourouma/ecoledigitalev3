import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerRisqueQuery,
  OwnerRisqueResponse,
  OwnerRisqueSignalKey,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { PRO_UNPAID_INSTALLMENTS_CTE } from "./owner-pro-outstanding.sql";

/**
 * Qualité et risque.
 *
 * Troisième question d'un propriétaire : « la machine pédagogique tourne-t-elle,
 * et qui est en train de me filer entre les doigts ? »
 *
 * L'écran produit une chose qu'aucun autre ne produit : une LISTE D'APPELS
 * TÉLÉPHONIQUES À PASSER CETTE SEMAINE. Un décrochage évité, c'est une année de
 * scolarité conservée — la meilleure ligne de chiffre d'affaires d'une école.
 *
 * Il restitue aussi ce que la direction ne peut pas voir aujourd'hui :
 * l'avancement de la saisie NOMMÉMENT par enseignant (qui bloque la génération
 * des bulletins), et la corrélation entre assiduité et résultats, qui permet de
 * défendre la politique d'assiduité avec un chiffre plutôt qu'un discours.
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
    log.warn({ err: e, label }, "owner risque query failed");
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

function rate(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return round1((100 * part) / whole);
}

/**
 * Pondération des quatre signaux du score de décrochage.
 *
 * Un signal NON MESURABLE (support de cours quand l'établissement n'en dépose
 * aucun, résultats quand rien n'est encore noté) est retiré du calcul et son
 * poids redistribué sur les autres, plutôt que compté comme un zéro. Compter
 * une donnée absente comme « rien à signaler » endormirait l'alerte ; la
 * compter comme un risque déclencherait des appels pour rien.
 */
const SIGNAL_WEIGHTS: Record<OwnerRisqueSignalKey, number> = {
  absence: 35,
  resultats: 30,
  impaye: 25,
  supports: 10,
};

const SIGNAL_LABELS: Record<OwnerRisqueSignalKey, string> = {
  absence: "Absences",
  resultats: "Résultats",
  impaye: "Impayé",
  supports: "Supports non consultés",
};

/** Au-dessus de ce score, l'étudiant est à rappeler ; en dessous, à surveiller. */
const RISK_THRESHOLD = 70;
const WATCH_THRESHOLD = 40;

/** Nombre de lignes détaillées renvoyées par tableau. */
const ROWS_LIMIT = 200;

/**
 * Durée d'une séance, en heures.
 *
 * `heure_debut` et `heure_fin` sont NULLABLE et il n'existe aucune colonne de
 * durée : une séance sans horaire ne pèse rien dans le calcul. On les compte à
 * part pour pouvoir dire combien de séances échappent à la mesure au lieu de
 * laisser croire à un taux exact.
 */
const SEANCE_HOURS = `
  CASE WHEN se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL
       THEN EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0
       ELSE 0 END`;

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerRisque(
  pool: Pool,
  tenantId: string,
  query: OwnerRisqueQuery,
  log: FastifyBaseLogger
): Promise<OwnerRisqueResponse> {
  const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Mesurabilité du signal « supports » ------------------------------ */
    // Sans support déposé, ou sans aucune consultation jamais enregistrée, le
    // signal ne distingue rien : tout le monde serait « à risque ».
    const coverageRows = await safeRows<Row>(
      client,
      `SELECT
         (SELECT COUNT(*) FROM professional_ecue_materials WHERE tenant_id = $1::uuid)::int AS materials,
         (SELECT COUNT(*) FROM professional_ecue_material_views WHERE tenant_id = $1::uuid)::int AS views`,
      [tenantId],
      log,
      "supportsCoverage"
    );
    const supportsMeasurable =
      num(coverageRows[0]?.materials) > 0 && num(coverageRows[0]?.views) > 0;

    /* ---- Fenêtre d'observation de l'assiduité ------------------------------ */
    /**
     * Par défaut : les 30 derniers jours — c'est la bonne fenêtre pour une liste
     * d'appels à passer cette semaine.
     *
     * Mais un établissement dont le semestre est clos n'a plus aucune séance
     * récente : la fenêtre glissante renverrait « 0 h sur 0 h » pour tout le
     * monde, ce qui se lit comme une panne. On la recale alors sur les 30 jours
     * précédant la DERNIÈRE séance connue, et la réponse le signale pour que
     * l'écran ne fasse pas passer une photo d'archive pour l'actualité.
     */
    const anchorRows = await safeRows<Row>(
      client,
      `SELECT MAX(date)::text AS derniere_seance
         FROM professional_ecue_seances
        WHERE tenant_id = $1::uuid AND date <= CURRENT_DATE`,
      [tenantId],
      log,
      "derniereSeance"
    );
    const lastSeance = anchorRows[0]?.derniere_seance
      ? String(anchorRows[0].derniere_seance).slice(0, 10)
      : null;
    const today = new Date().toISOString().slice(0, 10);
    const staleThreshold = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const windowShifted = lastSeance !== null && lastSeance < staleThreshold;
    const windowEnd = windowShifted ? lastSeance! : today;

    /* ---- Signaux par étudiant --------------------------------------------- */
    const studentRows = await safeRows<Row>(
      client,
      `WITH cohorte AS (
         -- Étudiants engagés dans au moins une cohorte non annulée.
         SELECT DISTINCT en.student_id, u.filiere_id
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
           AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
       ),
       /* Assiduité sur 30 jours, pondérée par la durée réelle des séances. */
       absences AS (
         SELECT a.student_id,
                SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'absent')::float8 AS heures_absence,
                SUM(${SEANCE_HOURS})::float8 AS heures_total,
                COUNT(*)::int AS pointages,
                COUNT(*) FILTER (WHERE se.heure_debut IS NULL OR se.heure_fin IS NULL)::int AS sans_horaire
         FROM professional_ecue_attendance a
         JOIN professional_ecue_seances se ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1::uuid
           AND se.date > $3::date - 30
           AND se.date <= $3::date
         GROUP BY a.student_id
       ),
       /* Résultats : moyenne courante et présence d'une note éliminatoire. */
       resultats AS (
         SELECT r.student_id,
                AVG(r.moyenne)::float8 AS moyenne,
                COUNT(*) FILTER (WHERE r.eliminee)::int AS nb_eliminees,
                COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL)::int AS nb_notes
         FROM professional_ecue_results r
         JOIN professional_ecue e ON e.id = r.ecue_id AND e.tenant_id = r.tenant_id
         WHERE r.tenant_id = $1::uuid
           -- La conduite n'est pas un résultat académique : l'inclure fausserait
           -- la moyenne servant de signal de décrochage.
           AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         GROUP BY r.student_id
       ),
       /* Impayé : reste dû et ancienneté de la plus vieille échéance non soldée.
          Le calcul est partagé avec le pouls et la trésorerie (fragment unique),
          pour que les trois écrans annoncent le même montant. */
       ${PRO_UNPAID_INSTALLMENTS_CTE},
       impayes AS (
         SELECT student_id,
                SUM(unpaid)::float8 AS reste,
                MIN(due_date) FILTER (WHERE unpaid > 0) AS plus_vieille_echeance
         FROM pro_unpaid_installments
         GROUP BY student_id
       ),
       /* Dernière consultation d'un support de cours. */
       vues AS (
         SELECT sp.id AS student_id, MAX(v.opened_at) AS derniere_vue
         FROM professional_ecue_material_views v
         JOIN student_profiles sp ON sp.user_id = v.user_id AND sp.tenant_id = v.tenant_id
         WHERE v.tenant_id = $1::uuid
         GROUP BY sp.id
       )
       SELECT
         c.student_id,
         TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS nom,
         COALESCE(sp.student_matricule, sp.student_number) AS matricule,
         us.email,
         sp.phone,
         pr.name AS filiere_name,
         COALESCE(ab.heures_absence, 0)::float8 AS heures_absence,
         COALESCE(ab.heures_total, 0)::float8 AS heures_total,
         COALESCE(ab.pointages, 0)::int AS pointages,
         COALESCE(ab.sans_horaire, 0)::int AS seances_sans_horaire,
         re.moyenne,
         COALESCE(re.nb_eliminees, 0)::int AS nb_eliminees,
         COALESCE(re.nb_notes, 0)::int AS nb_notes,
         COALESCE(im.reste, 0)::float8 AS reste_du,
         im.plus_vieille_echeance,
         vu.derniere_vue
       FROM cohorte c
       JOIN student_profiles sp ON sp.id = c.student_id AND sp.tenant_id = $1::uuid
       LEFT JOIN users us ON us.id = sp.user_id AND us.tenant_id = sp.tenant_id
       LEFT JOIN programmes pr ON pr.id = c.filiere_id AND pr.tenant_id = $1::uuid
       LEFT JOIN absences ab ON ab.student_id = c.student_id
       LEFT JOIN resultats re ON re.student_id = c.student_id
       LEFT JOIN impayes im ON im.student_id = c.student_id
       LEFT JOIN vues vu ON vu.student_id = c.student_id`,
      [tenantId, filiereIds, windowEnd],
      log,
      "signauxEtudiants"
    );

    const students = studentRows
      .map((r) => {
        const heuresAbsence = round1(num(r.heures_absence));
        const heuresTotal = round1(num(r.heures_total));
        const moyenne = r.moyenne === null ? null : round1(num(r.moyenne));
        const nbEliminees = Math.round(num(r.nb_eliminees));
        const nbNotes = Math.round(num(r.nb_notes));
        const resteDu = Math.round(num(r.reste_du));
        const oldestDue = r.plus_vieille_echeance
          ? String(r.plus_vieille_echeance).slice(0, 10)
          : null;
        const derniereVue = r.derniere_vue ? new Date(r.derniere_vue as string) : null;

        /* --- Signal 1 : absences ------------------------------------------ */
        // Non mesurable sans heures pointées sur la période.
        const scores: Partial<Record<OwnerRisqueSignalKey, number>> = {};
        if (heuresTotal > 0) {
          const tauxAbsence = (100 * heuresAbsence) / heuresTotal;
          // 50 % d'absence sature le signal : au-delà, le décrochage est acquis.
          scores.absence = Math.min(100, tauxAbsence * 2);
        }

        /* --- Signal 2 : résultats ----------------------------------------- */
        if (nbNotes > 0) {
          if (nbEliminees > 0) {
            // Une note éliminatoire bloque l'UE sans compensation possible.
            scores.resultats = 100;
          } else if (moyenne !== null && moyenne < 10) {
            scores.resultats = Math.min(100, ((10 - moyenne) / 10) * 100);
          } else {
            scores.resultats = 0;
          }
        }

        /* --- Signal 3 : impayé -------------------------------------------- */
        // Toujours mesurable : « rien à devoir » est une information, pas un trou.
        const joursRetard = oldestDue
          ? Math.floor((Date.now() - Date.parse(oldestDue)) / 86_400_000)
          : 0;
        scores.impaye = resteDu <= 0 ? 0 : joursRetard > 45 ? 100 : 50;

        /* --- Signal 4 : supports de cours --------------------------------- */
        if (supportsMeasurable) {
          const vuRecente =
            derniereVue !== null && Date.now() - derniereVue.getTime() <= 30 * 86_400_000;
          scores.supports = vuRecente ? 0 : 100;
        }

        // Somme pondérée sur les seuls signaux mesurables.
        let totalWeight = 0;
        let weighted = 0;
        const measured: OwnerRisqueSignalKey[] = [];
        for (const key of Object.keys(SIGNAL_WEIGHTS) as OwnerRisqueSignalKey[]) {
          const s = scores[key];
          if (s === undefined) continue;
          measured.push(key);
          totalWeight += SIGNAL_WEIGHTS[key];
          weighted += s * SIGNAL_WEIGHTS[key];
        }
        const score = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

        // Motif dominant : le signal qui pèse le plus dans le score, pour que la
        // personne qui décroche le téléphone sache de quoi parler.
        let dominant: OwnerRisqueSignalKey | null = null;
        let best = -1;
        for (const key of measured) {
          const contribution = (scores[key] ?? 0) * SIGNAL_WEIGHTS[key];
          if (contribution > best) {
            best = contribution;
            dominant = key;
          }
        }

        return {
          studentId: String(r.student_id),
          nom: String(r.nom || "").trim() || "Étudiant inconnu",
          matricule: (r.matricule as string | null) ?? null,
          email: (r.email as string | null) ?? null,
          telephone: (r.phone as string | null) ?? null,
          filiereName: (r.filiere_name as string | null) ?? null,
          score,
          motifDominant: dominant ? SIGNAL_LABELS[dominant] : "—",
          signauxMesures: measured,
          heuresAbsence,
          heuresTotal,
          tauxAbsence: rate(heuresAbsence, heuresTotal),
          moyenne,
          nbEliminees,
          resteDu,
          joursRetardPaiement: resteDu > 0 && oldestDue ? joursRetard : null,
          seancesSansHoraire: Math.round(num(r.seances_sans_horaire)),
        };
      })
      .sort((a, b) => b.score - a.score);

    const aRisque = students.filter((s) => s.score >= RISK_THRESHOLD);
    const aSurveiller = students.filter(
      (s) => s.score >= WATCH_THRESHOLD && s.score < RISK_THRESHOLD
    );

    /* ---- Avancement de la saisie, par enseignant nommé --------------------- */
    const teacherRows = await safeRows<Row>(
      client,
      `WITH affectations AS (
         SELECT st.enseignant_id, st.ue_session_id, st.ecue_id
         FROM professional_session_ecue_teachers st
         JOIN professional_ue_sessions s ON s.id = st.ue_session_id AND s.tenant_id = st.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE st.tenant_id = $1::uuid
           AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
       ),
       /* Notes attendues : une note d'examen par inscrit, sur les cohortes closes. */
       attendus AS (
         SELECT a.enseignant_id,
                COUNT(*)::int AS attendues,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM professional_ecue_notes n
                   WHERE n.tenant_id = $1::uuid
                     AND n.ue_session_id = a.ue_session_id
                     AND n.ecue_id = a.ecue_id
                     AND n.student_id = en.student_id
                     AND n.nature = 'examen'
                ))::int AS saisies
         FROM affectations a
         JOIN professional_ue_sessions s ON s.id = a.ue_session_id AND s.tenant_id = $1::uuid
         JOIN professional_enrollments en
           ON en.ue_session_id = a.ue_session_id
          AND en.tenant_id = $1::uuid
          AND en.statut IN ('confirmee', 'terminee')
         WHERE s.date_fin < CURRENT_DATE OR s.statut = 'termine'
         GROUP BY a.enseignant_id
       ),
       /* Appels : séances passées des 30 derniers jours, pointées ou non. */
       appels AS (
         SELECT se.enseignant_id,
                COUNT(*)::int AS seances,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM professional_ecue_attendance a
                   WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id
                ))::int AS pointees
         FROM professional_ecue_seances se
         WHERE se.tenant_id = $1::uuid
           AND se.date > $3::date - 30
           AND se.date <= $3::date
           AND se.enseignant_id IS NOT NULL
         GROUP BY se.enseignant_id
       )
       SELECT
         t.id AS teacher_id,
         TRIM(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) AS nom,
         COALESCE(at.attendues, 0)::int AS notes_attendues,
         COALESCE(at.saisies, 0)::int AS notes_saisies,
         COALESCE(ap.seances, 0)::int AS seances,
         COALESCE(ap.pointees, 0)::int AS seances_pointees
       FROM teachers t
       LEFT JOIN attendus at ON at.enseignant_id = t.id
       LEFT JOIN appels ap ON ap.enseignant_id = t.id
       WHERE t.tenant_id = $1::uuid
         AND (at.attendues IS NOT NULL OR ap.seances IS NOT NULL)
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds, windowEnd],
      log,
      "avancementEnseignants"
    );

    const enseignants = teacherRows
      .map((r) => {
        const attendues = Math.round(num(r.notes_attendues));
        const saisies = Math.round(num(r.notes_saisies));
        const seances = Math.round(num(r.seances));
        const pointees = Math.round(num(r.seances_pointees));
        return {
          teacherId: String(r.teacher_id),
          nom: String(r.nom || "").trim() || "Enseignant inconnu",
          notesAttendues: attendues,
          notesSaisies: saisies,
          tauxSaisie: rate(saisies, attendues),
          seances30j: seances,
          seancesPointees30j: pointees,
          tauxAppels: rate(pointees, seances),
        };
      })
      // Les plus en retard d'abord : c'est la liste des relances à faire.
      .sort((a, b) => (a.tauxSaisie ?? 101) - (b.tauxSaisie ?? 101));

    /* ---- Tendance de présence, 7 jours contre 30 jours --------------------- */
    const trendRows = await safeRows<Row>(
      client,
      `SELECT
         pr.id AS filiere_id,
         pr.name AS filiere_name,
         -- Le WHERE borne déjà la fenêtre de 30 jours (calée sur la dernière
         -- séance quand le semestre est clos) : on compte tout le groupe.
         COUNT(*)::int AS pointages_30j,
         COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presents_30j,
         COUNT(*) FILTER (WHERE se.date > $3::date - 7)::int AS pointages_7j,
         COUNT(*) FILTER (WHERE se.date > $3::date - 7
                            AND a.statut IN ('present', 'retard'))::int AS presents_7j
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN professional_ue_sessions s ON s.id = se.ue_session_id AND s.tenant_id = se.tenant_id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN programmes pr ON pr.id = u.filiere_id AND pr.tenant_id = u.tenant_id
       WHERE a.tenant_id = $1::uuid
         AND se.date > $3::date - 30
         AND se.date <= $3::date
         AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
       GROUP BY pr.id, pr.name
       ORDER BY pr.name`,
      [tenantId, filiereIds, windowEnd],
      log,
      "tendancePresence"
    );

    const presence = trendRows.map((r) => {
      const p30 = rate(num(r.presents_30j), num(r.pointages_30j));
      const p7 = rate(num(r.presents_7j), num(r.pointages_7j));
      return {
        filiereId: String(r.filiere_id),
        filiereName: String(r.filiere_name),
        taux30j: p30,
        taux7j: p7,
        // `null` quand l'une des deux fenêtres est vide : un écart calculé sur
        // rien serait une fausse alerte.
        ecart: p30 !== null && p7 !== null ? round1(p7 - p30) : null,
      };
    });

    /* ---- Corrélation assiduité / résultats --------------------------------- */
    // Un point par étudiant disposant des deux mesures. Le nuage est le seul
    // moyen de défendre la politique d'assiduité avec un chiffre.
    const correlation = students
      .filter((s) => s.moyenne !== null && s.heuresTotal > 0)
      .map((s) => ({
        studentId: s.studentId,
        heuresAbsence: s.heuresAbsence,
        moyenne: s.moyenne as number,
        filiereName: s.filiereName,
      }));

    return {
      computedAt: new Date().toISOString(),
      kpis: {
        etudiantsSuivis: students.length,
        aRisque: aRisque.length,
        aSurveiller: aSurveiller.length,
        seuilRisque: RISK_THRESHOLD,
        supportsMesurables: supportsMeasurable,
        enseignantsEnRetardSaisie: enseignants.filter(
          (e) => e.tauxSaisie !== null && e.tauxSaisie < 100
        ).length,
        enseignantsSousAppel: enseignants.filter(
          (e) => e.tauxAppels !== null && e.tauxAppels < 60
        ).length,
      },
      students: students.slice(0, ROWS_LIMIT),
      enseignants,
      presence,
      correlation,
    };
  } finally {
    client.release();
  }
}

/** Liste nominative exportable : la feuille d'appels de la semaine. */
export function buildOwnerRisqueCsv(data: OwnerRisqueResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

  lines.push("Étudiants à risque de décrochage");
  lines.push(
    "Score;Motif dominant;Nom;Matricule;Filière;Téléphone;E-mail;Heures d'absence 30j;Taux d'absence %;Moyenne;Notes éliminatoires;Reste dû;Jours de retard"
  );
  for (const s of data.students) {
    lines.push(
      [
        s.score,
        esc(s.motifDominant),
        esc(s.nom),
        esc(s.matricule ?? ""),
        esc(s.filiereName ?? ""),
        esc(s.telephone ?? ""),
        esc(s.email ?? ""),
        s.heuresAbsence,
        s.tauxAbsence ?? "",
        s.moyenne ?? "",
        s.nbEliminees,
        s.resteDu,
        s.joursRetardPaiement ?? "",
      ].join(";")
    );
  }

  lines.push("");
  lines.push("Avancement de la saisie par enseignant");
  lines.push("Enseignant;Notes saisies;Notes attendues;Taux de saisie %;Séances 30j;Séances pointées;Taux d'appels %");
  for (const e of data.enseignants) {
    lines.push(
      [
        esc(e.nom),
        e.notesSaisies,
        e.notesAttendues,
        e.tauxSaisie ?? "",
        e.seances30j,
        e.seancesPointees30j,
        e.tauxAppels ?? "",
      ].join(";")
    );
  }

  return lines.join("\n");
}
