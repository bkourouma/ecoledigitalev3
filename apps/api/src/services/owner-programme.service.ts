import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerProgrammeQuery, OwnerProgrammeResponse } from "@ecoledigitale/contracts";
import {
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  perimetreArgs,
} from "./owner-perimetre.sql";

/**
 * Programme — UE, ECUE et maquette.
 *
 * Dernière entrée manquante du miroir du menu administrateur.
 *
 * CE QU'IL AJOUTE
 *
 * Le catalogue disait ce que l'école propose ; il ne disait pas ce que chaque
 * unité d'enseignement RAPPORTE ni ce qu'elle PÈSE. Une UE est à la fois un
 * produit — un prix, des inscrits — et une brique pédagogique — des crédits,
 * des ECUE. Les deux se lisent ensemble ou pas du tout : une UE à 150 000 FCFA
 * qui ne pèse qu'un crédit n'est pas le même objet qu'une UE à 60 000 qui en
 * pèse huit.
 *
 * L'ÉCART DE MAQUETTE
 *
 * `nb_uv` est la valeur AFFICHÉE ; la somme des crédits des ECUE est celle
 * réellement UTILISÉE en pondération, et c'est elle qui s'imprime sur les
 * relevés et les diplômes. Quand les deux divergent, l'écran montre autre chose
 * que ce qui est calculé, et le document officiel porte un nombre de crédits
 * faux. À corriger AVANT de générer les bulletins d'une promotion — sinon il
 * faut réimprimer.
 *
 * LA CONDUITE EST EXCLUE DES COMPTES DE MAQUETTE
 *
 * Elle ne s'enseigne pas, ne se vend pas et ne se rattrape pas. Ses 118 UE
 * portent toutes un prix nul et une maquette propre à elles : les mêler aux UE
 * vendables ferait dire n'importe quoi au prix moyen comme aux écarts.
 */

type Row = Record<string, unknown>;

/** Plafond d'affichage : le catalogue compte près de 500 UE. */
const UE_LIMIT = 200;

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
    log.warn({ err: e, label }, "owner programme query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Prédicat canonique du dépôt : la conduite, partout repérée de la même façon. */
const UE_NON_CONDUITE = `u.libelle NOT ILIKE 'conduite%'`;

export async function fetchOwnerProgramme(
  pool: Pool,
  tenantId: string,
  query: OwnerProgrammeQuery,
  log: FastifyBaseLogger
): Promise<OwnerProgrammeResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
    const nomClasse = query.nomClasse?.trim() ? query.nomClasse.trim() : null;
    const perimetre = perimetreArgs({
      tenantId,
      anneeScolaire: query.anneeScolaire ?? null,
      filiereIds,
      nomClasse,
      semestreId: query.semestreId ?? null,
    });

    /* ---- Une ligne par UE : le produit et la brique pédagogique ----------- */
    const ueRows = await safeRows<Row>(
      client,
      `WITH ${OUVERTURES_CTE},
       ${OUVERTURES_PERIMETRE_CTE}
       SELECT u.id AS ue_id,
              u.code,
              u.libelle,
              pr.name AS filiere_name,
              u.categorie::text AS categorie,
              u.nb_uv,
              u.prix::float8 AS prix,
              COALESCE(sc.somme, 0)::int AS somme_credits,
              COALESCE(sc.ecue, 0)::int  AS ecue,
              COUNT(op.ue_session_id)::int AS ouvertures,
              (SELECT COUNT(DISTINCT en.student_id)
                 FROM professional_enrollments en
                 JOIN ouvertures_perimetre o2 ON o2.ue_session_id = en.ue_session_id
                WHERE o2.ue_id = u.id AND en.tenant_id = $1::uuid
                  AND en.statut <> 'annulee')::int AS inscrits,
              /* Heures planifiees : NULL et non 0 quand aucune seance n est
                 horodatee. Un zero se lirait « cette UE ne se donne pas ». */
              (SELECT SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)
                 FROM professional_ecue_seances se
                 JOIN ouvertures_perimetre o3 ON o3.ue_session_id = se.ue_session_id
                WHERE o3.ue_id = u.id AND se.tenant_id = $1::uuid
                  AND se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL)::float8
                AS heures,
              COUNT(*) OVER ()::int AS total
         FROM professional_ue u
         LEFT JOIN programmes pr ON pr.id = u.filiere_id AND pr.tenant_id = u.tenant_id
         LEFT JOIN LATERAL (
           SELECT SUM(e.credits)::int AS somme, COUNT(*)::int AS ecue
             FROM professional_ue_ecue l
             JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
            WHERE l.ue_id = u.id AND l.tenant_id = u.tenant_id
         ) sc ON TRUE
         LEFT JOIN ouvertures_perimetre op ON op.ue_id = u.id
        WHERE u.tenant_id = $1::uuid
          AND u.statut = 'actif'
          AND ($3::uuid[] IS NULL OR u.filiere_id = ANY($3::uuid[]))
          AND ($4::text IS NULL
               OR u.filiere_id::text = split_part($4::text, '|', 1))
          /* $2 et $5 agissent par ouvertures_perimetre. Les citer reste
             obligatoire : Postgres refuse un parametre fourni qu il ne peut
             pas typer. */
          AND ($2::text IS NULL OR TRUE)
          AND ($5::uuid IS NULL OR TRUE)
        GROUP BY u.id, u.code, u.libelle, pr.name, u.categorie, u.nb_uv, u.prix,
                 sc.somme, sc.ecue
        /* Le programme EN PRODUCTION d'abord : une UE jamais ouverte se corrige
           quand on veut, une UE qui tourne se corrige avant les bulletins. */
        ORDER BY COUNT(op.ue_session_id) DESC, u.code
        LIMIT ${UE_LIMIT}`,
      perimetre,
      log,
      "programmeUe"
    );

    /* ---- Comptes du catalogue, hors conduite ------------------------------ */
    const kpiRows = await safeRows<Row>(
      client,
      `SELECT
         (SELECT COUNT(*) FROM professional_ue u
           WHERE u.tenant_id = $1::uuid AND u.statut = 'actif'
             AND ${UE_NON_CONDUITE}
             AND ($3::uuid[] IS NULL OR u.filiere_id = ANY($3::uuid[]))
             AND ($4::text IS NULL
                  OR u.filiere_id::text = split_part($4::text, '|', 1)))::int AS ue_actives,
         (SELECT COUNT(*) FROM professional_ue u
           WHERE u.tenant_id = $1::uuid AND u.statut = 'actif'
             AND ${UE_NON_CONDUITE}
             AND ($3::uuid[] IS NULL OR u.filiere_id = ANY($3::uuid[]))
             AND ($4::text IS NULL
                  OR u.filiere_id::text = split_part($4::text, '|', 1))
             AND EXISTS (SELECT 1 FROM professional_ue_sessions s
                          WHERE s.ue_id = u.id AND s.tenant_id = u.tenant_id))::int AS ue_ouvertes,
         (SELECT COUNT(*) FROM professional_ecue e
           WHERE e.tenant_id = $1::uuid AND e.statut = 'actif')::int AS ecue_actives,
         /* L ecart de maquette : la valeur affichee contre celle qui s imprime.
            La conduite est exclue — sa maquette lui est propre. */
         (SELECT COUNT(*) FROM professional_ue u
           WHERE u.tenant_id = $1::uuid AND u.statut = 'actif'
             AND ${UE_NON_CONDUITE}
             AND ($3::uuid[] IS NULL OR u.filiere_id = ANY($3::uuid[]))
             AND ($4::text IS NULL
                  OR u.filiere_id::text = split_part($4::text, '|', 1))
             AND u.nb_uv > 0
             AND u.nb_uv <> COALESCE((SELECT SUM(e.credits) FROM professional_ue_ecue l
                                        JOIN professional_ecue e
                                          ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
                                       WHERE l.ue_id = u.id AND l.tenant_id = u.tenant_id), 0))::int
           AS ecarts_maquette,
         (SELECT COUNT(*) FROM professional_ecue e
           WHERE e.tenant_id = $1::uuid AND e.statut = 'actif'
             AND e.credits IS NULL)::int AS ecue_sans_credit,
         (SELECT COUNT(*) FROM professional_ecue e
           WHERE e.tenant_id = $1::uuid AND e.statut = 'actif'
             AND NOT EXISTS (SELECT 1 FROM professional_ue_ecue l
                              WHERE l.ecue_id = e.id AND l.tenant_id = e.tenant_id))::int
           AS ecue_orphelines,
         /* Prix moyen des UE VENDABLES : la conduite, gratuite par conception,
            tirerait la moyenne vers le bas sans rien signifier. */
         (SELECT AVG(u.prix) FROM professional_ue u
           WHERE u.tenant_id = $1::uuid AND u.statut = 'actif'
             AND ${UE_NON_CONDUITE} AND u.prix > 0
             AND ($3::uuid[] IS NULL OR u.filiere_id = ANY($3::uuid[]))
             AND ($4::text IS NULL
                  OR u.filiere_id::text = split_part($4::text, '|', 1)))::float8 AS prix_moyen,
         /* Le volume horaire est-il exploitable ? */
         (SELECT COUNT(*) FROM professional_ecue_seances se
           WHERE se.tenant_id = $1::uuid)::int AS seances,
         (SELECT COUNT(*) FROM professional_ecue_seances se
           WHERE se.tenant_id = $1::uuid
             AND se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL)::int
           AS seances_horodatees,
         ($2::text IS NULL OR TRUE) AS ignore_annee,
         ($5::uuid IS NULL OR TRUE) AS ignore_semestre`,
      perimetre,
      log,
      "programmeKpis"
    );
    const k = kpiRows[0] ?? {};

    const seances = Math.round(num(k.seances));
    const horodatees = Math.round(num(k.seances_horodatees));
    const ueOuvertes = Math.round(num(k.ue_ouvertes));
    /*
       LE VOLUME HORAIRE N'EST EXPLOITABLE QUE S'IL COUVRE LE PROGRAMME.

       Trois séances sur une seule ouverture ne décrivent pas une dotation
       horaire : elles décrivent un planning qui n'a pas été saisi. Publier un
       rapport heures/crédits là-dessus ferait passer une absence de planning
       pour une sous-dotation, ce qui est l'inverse du diagnostic.

       Le seuil retenu est simple et défendable : il faut au moins autant de
       séances horodatées que d'UE ouvertes, faute de quoi la moyenne porterait
       sur une poignée d'entre elles.
    */
    const volumeMesurable = horodatees > 0 && ueOuvertes > 0 && horodatees >= ueOuvertes;

    return {
      computedAt: new Date().toISOString(),
      kpis: {
        ueActives: Math.round(num(k.ue_actives)),
        ueOuvertes,
        ecueActives: Math.round(num(k.ecue_actives)),
        ecartsMaquette: Math.round(num(k.ecarts_maquette)),
        ecueSansCredit: Math.round(num(k.ecue_sans_credit)),
        ecueOrphelines: Math.round(num(k.ecue_orphelines)),
        /* NULL et non 0 : aucune UE tarifée ne donne pas un prix moyen nul. */
        prixMoyen:
          k.prix_moyen === null || k.prix_moyen === undefined
            ? null
            : Math.round(num(k.prix_moyen)),
      },
      ue: ueRows.map((r) => {
        const nbUv = Math.round(num(r.nb_uv));
        const somme = Math.round(num(r.somme_credits));
        return {
          ueId: String(r.ue_id),
          code: String(r.code ?? ""),
          libelle: String(r.libelle ?? ""),
          filiereName: (r.filiere_name as string | null) ?? null,
          categorie: (r.categorie as string | null) ?? null,
          nbUv,
          sommeCredits: somme,
          /* L'écart ne se signale que si des crédits sont déclarés : une UE à
             nb_uv = 0 n'affiche rien, elle ne contredit rien. */
          ecartMaquette: nbUv > 0 && nbUv !== somme,
          prix: Math.round(num(r.prix)),
          ecue: Math.round(num(r.ecue)),
          ouvertures: Math.round(num(r.ouvertures)),
          inscrits: Math.round(num(r.inscrits)),
          heuresPlanifiees:
            r.heures === null || r.heures === undefined
              ? null
              : Math.round(num(r.heures) * 10) / 10,
        };
      }),
      ueTotal: ueRows.length > 0 ? Math.round(num(ueRows[0].total)) : 0,
      volumeHoraire: {
        mesurable: volumeMesurable,
        seances,
        seancesHorodatees: horodatees,
        raison: volumeMesurable
          ? null
          : seances === 0
            ? "Aucune séance n'est planifiée : le volume horaire n'existe pas encore."
            : `Seules ${horodatees} séance(s) sont horodatées pour ${ueOuvertes} UE ouverte(s). Un rapport heures/crédits bâti là-dessus ferait passer un planning non saisi pour une sous-dotation horaire.`,
      },
      anneeScolaire: query.anneeScolaire ?? null,
      filiereIds: filiereIds ?? [],
      nomClasse,
    };
  } finally {
    client.release();
  }
}

/** Export : les UE telles qu'affichées. */
export function buildOwnerProgrammeCsv(data: OwnerProgrammeResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

  lines.push("Programme — unités d'enseignement et maquette");
  lines.push("Année scolaire;" + esc(data.anneeScolaire ?? "Toutes années"));
  lines.push(
    "Périmètre;" +
      esc(
        data.nomClasse
          ? `Classe : ${data.nomClasse.split("|").pop()}`
          : data.filiereIds.length > 0
            ? `${data.filiereIds.length} filière(s)`
            : "Toutes filières"
      )
  );
  lines.push(
    "Écarts de maquette;" +
      esc(
        `${data.kpis.ecartsMaquette} UE affichent un nombre de crédits différent de celui qui s'imprime sur les documents`
      )
  );
  lines.push("");

  lines.push(
    "Code;Libellé;Classe;Catégorie;Crédits affichés;Crédits calculés;Écart;Prix;ECUE;Ouvertures;Inscrits;Heures planifiées"
  );
  for (const u of data.ue) {
    lines.push(
      [
        esc(u.code),
        esc(u.libelle),
        esc(u.filiereName ?? ""),
        esc(u.categorie ?? ""),
        u.nbUv,
        u.sommeCredits,
        u.ecartMaquette ? "OUI" : "",
        u.prix,
        u.ecue,
        u.ouvertures,
        u.inscrits,
        u.heuresPlanifiees ?? "",
      ].join(";")
    );
  }

  if (!data.volumeHoraire.mesurable) {
    lines.push("");
    lines.push("Volume horaire;" + esc(data.volumeHoraire.raison ?? "Non mesurable"));
  }

  return lines.join("\n");
}
