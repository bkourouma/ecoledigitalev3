import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerDocumentsQuery, OwnerDocumentsResponse } from "@ecoledigitale/contracts";
import { SIGNATAIRES_DEFAULTS } from "./professional-signataires.service";
import {
  ETUDIANTS_PERIMETRE_CTE,
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  perimetreArgs,
} from "./owner-perimetre.sql";

/**
 * Documents officiels — diplômes, signataires, complétude des dossiers.
 *
 * Trois entrées au menu administrateur, aucune couverture propriétaire jusqu'ici.
 *
 * LES DEUX FAITS QUE CET ÉCRAN REND VISIBLES
 *
 * 1. L'ÉLIGIBLE NON DIPLÔMÉ. Il a payé, il a validé ses UV, et il attend un
 *    papier. C'est un dossier fini qui dort, et le seul chiffre de cet écran qui
 *    se traduise en action dans la journée.
 *
 * 2. L'OCTROI SANS LES UV. Plus rare et plus grave : un titre délivré à
 *    quelqu'un qui n'a pas les crédits. Ce n'est pas une faute de saisie, c'est
 *    un diplôme attaquable. Mesuré le 23/09/2026 : 2 octrois pour 0 éligible.
 *
 * LES SIGNATAIRES, ET POURQUOI CE BLOC EXISTE
 *
 * Les quatre signataires livrés avec l'application sont des **noms de personnes
 * réelles**, codés en dur dans `professional-signataires.service.ts` et repris
 * côté web dans `diplome-format.ts`. Tant qu'un établissement ne les a pas
 * remplacés, ses diplômes portent la signature de gens qui n'ont jamais vu ses
 * étudiants — et rien ne le signale, puisque le document sort correctement
 * formé. La comparaison se fait contre `SIGNATAIRES_DEFAULTS`, importé et non
 * recopié : une seconde liste finirait par diverger et l'alerte se tairait.
 *
 * ⚠ CE QUI N'EST PAS MESURABLE
 *
 * Il n'existe **aucune table d'attestations** : elles sont recalculées à chaque
 * génération, sans date d'émission ni compteur. Le volume émis est hors de
 * portée, et la réponse le déclare au lieu de rendre un zéro qui se lirait
 * « aucune attestation n'a jamais été délivrée ».
 */

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
    log.warn({ err: e, label }, "owner documents query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export async function fetchOwnerDocuments(
  pool: Pool,
  tenantId: string,
  query: OwnerDocumentsQuery,
  log: FastifyBaseLogger
): Promise<OwnerDocumentsResponse> {
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

    const SOCLE = [OUVERTURES_CTE, OUVERTURES_PERIMETRE_CTE, ETUDIANTS_PERIMETRE_CTE].join(
      ",\n"
    );

    /* ---- Pipeline de diplomation, par diplôme ----------------------------- */
    const pipelineRows = await safeRows<Row>(
      client,
      `WITH ${SOCLE},
       /* MEME REGLE QUE L ADMINISTRATION (evaluateDiplomaEligibility).
          Les UV d un etudiant pour un diplome sont celles des UE EXIGEES par ce
          diplome qu il a validees : une UE validee mais etrangere au diplome ne
          compte pas, et une exigence obligatoire manquante rend inelegible quel
          que soit le total. Additionner uv_acquises de tous ses resultats, comme
          on le faisait, ignorait la liste des exigences ET la Conduite : l ecran
          annoncait « 0 eligible, 2 octrois sans UV » quand l administration en
          voyait 2 eligibles. */
       ue_validees AS (
         /* Statut validee, ou — la Conduite ne passant jamais par les
            resultats d UE — une note d examen de Conduite >= 10. */
         SELECT r.student_id, r.ue_id
           FROM student_professional_ue_results r
          WHERE r.tenant_id = $1::uuid AND r.statut = 'validee'
         UNION
         SELECT n.student_id, l.ue_id
           FROM professional_ecue_notes n
           JOIN professional_ecue e ON e.id = n.ecue_id AND e.tenant_id = n.tenant_id
           JOIN professional_ue_ecue l ON l.ecue_id = e.id AND l.tenant_id = e.tenant_id
          WHERE n.tenant_id = $1::uuid AND n.nature = 'examen' AND n.note >= 10
            AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
       ),
       exigences AS (
         /* Une ligne par (diplome, UE) : l obligatoire prime, comme a l eval. */
         SELECT dr.diploma_id, dr.ue_id,
                bool_or(dr.est_obligatoire) AS obligatoire,
                MAX(u.nb_uv) AS nb_uv
           FROM professional_diploma_requirements dr
           JOIN professional_ue u ON u.id = dr.ue_id AND u.tenant_id = dr.tenant_id
          WHERE dr.tenant_id = $1::uuid
          GROUP BY dr.diploma_id, dr.ue_id
       ),
       candidats AS (
         /* Le vivier : les etudiants du PERIMETRE inscrits dans la filiere du
            diplome. Passer par etudiants_perimetre plutot que par toutes les
            inscriptions fait agir l annee et la classe sur cet ecran comme sur
            les autres. */
         SELECT DISTINCT d.id AS diploma_id, ep.student_id
           FROM professional_diplomas d
           JOIN etudiants_perimetre ep ON ep.filiere_id = d.filiere_id
          WHERE d.tenant_id = $1::uuid
       ),
       octroyes_actifs AS (
         SELECT sd.diploma_id, sd.student_id
           FROM student_professional_diplomas sd
          WHERE sd.tenant_id = $1::uuid AND sd.date_revocation IS NULL
       ),
       bilan AS (
         SELECT p.diploma_id, p.student_id,
                COALESCE(SUM(x.nb_uv) FILTER (WHERE v.ue_id IS NOT NULL), 0)::int AS uv,
                COALESCE(bool_and(v.ue_id IS NOT NULL OR NOT x.obligatoire), true) AS obligatoires_ok
           FROM (SELECT diploma_id, student_id FROM candidats
                 UNION
                 SELECT diploma_id, student_id FROM octroyes_actifs) p
           LEFT JOIN exigences x ON x.diploma_id = p.diploma_id
           LEFT JOIN ue_validees v ON v.student_id = p.student_id AND v.ue_id = x.ue_id
          GROUP BY p.diploma_id, p.student_id
       ),
       eligibles_bilan AS (
         SELECT b.diploma_id, b.student_id
           FROM bilan b
           JOIN professional_diplomas d ON d.id = b.diploma_id
          WHERE b.obligatoires_ok AND b.uv >= d.uv_required
       )
       SELECT d.id AS diploma_id,
              d.code,
              d.libelle,
              pr.name AS filiere_name,
              d.uv_required,
              COUNT(DISTINCT ca.student_id)::int AS candidats,
              COUNT(DISTINCT ca.student_id) FILTER (
                WHERE EXISTS (SELECT 1 FROM eligibles_bilan eb
                               WHERE eb.diploma_id = d.id
                                 AND eb.student_id = ca.student_id))::int AS eligibles,
              (SELECT COUNT(*) FROM student_professional_diplomas sd
                WHERE sd.diploma_id = d.id AND sd.tenant_id = $1::uuid
                  AND sd.date_revocation IS NULL)::int AS octroyes,
              (SELECT COUNT(*) FROM student_professional_diplomas sd
                WHERE sd.diploma_id = d.id AND sd.tenant_id = $1::uuid
                  AND sd.date_revocation IS NOT NULL)::int AS revoques,
              /* Eligible sans diplome : le dossier fini qui dort. */
              COUNT(DISTINCT ca.student_id) FILTER (
                WHERE EXISTS (SELECT 1 FROM eligibles_bilan eb
                               WHERE eb.diploma_id = d.id
                                 AND eb.student_id = ca.student_id)
                  AND NOT EXISTS (SELECT 1 FROM octroyes_actifs oa
                                   WHERE oa.diploma_id = d.id
                                     AND oa.student_id = ca.student_id))::int
                AS eligibles_non_diplomes,
              /* Octroi sans les UV requises : un titre attaquable. */
              (SELECT COUNT(*) FROM octroyes_actifs oa
                WHERE oa.diploma_id = d.id
                  AND NOT EXISTS (SELECT 1 FROM eligibles_bilan eb
                                   WHERE eb.diploma_id = oa.diploma_id
                                     AND eb.student_id = oa.student_id))::int AS octroyes_sans_uv
         FROM professional_diplomas d
         LEFT JOIN programmes pr ON pr.id = d.filiere_id AND pr.tenant_id = d.tenant_id
         LEFT JOIN candidats ca ON ca.diploma_id = d.id
        WHERE d.tenant_id = $1::uuid
          /* Le filtre de filiere s applique au diplome lui-meme : choisir une
             filiere ne doit pas laisser les diplomes des autres a zero. */
          AND ($3::uuid[] IS NULL OR d.filiere_id = ANY($3::uuid[]))
          AND ($4::text IS NULL
               OR d.filiere_id::text = split_part($4::text, '|', 1))
          /* $2 et $5 agissent a travers etudiants_perimetre, pas ici. Les citer
             est neanmoins obligatoire : Postgres refuse une requete dont il ne
             peut pas typer un parametre fourni. */
          AND ($2::text IS NULL OR TRUE)
          AND ($5::uuid IS NULL OR TRUE)
        GROUP BY d.id, d.code, d.libelle, pr.name, d.uv_required
        ORDER BY d.code`,
      perimetre,
      log,
      "pipelineDiplomes"
    );

    /* ---- Signataires ------------------------------------------------------ */
    const signataireRows = await safeRows<Row>(
      client,
      `SELECT cle, nom, fonction
         FROM professional_signataires
        WHERE tenant_id = $1::uuid`,
      [tenantId],
      log,
      "signataires"
    );

    /*
       Les quatre clés viennent du code, pas de la base : un établissement qui
       n'a AUCUNE ligne imprime tout de même les quatre valeurs par défaut, par
       le repli de `ProfessionalSignatairesService`. Partir de la base les
       aurait rendues invisibles — exactement le cas le plus dangereux.
    */
    const signataires = (
      Object.keys(SIGNATAIRES_DEFAULTS) as Array<keyof typeof SIGNATAIRES_DEFAULTS>
    ).map((cle) => {
      const defaut = SIGNATAIRES_DEFAULTS[cle];
      const ligne = signataireRows.find((r) => String(r.cle) === cle);
      const nom = ligne ? String(ligne.nom ?? "") : defaut.nom;
      return {
        cle: String(cle),
        nom,
        fonction: ligne
          ? ((ligne.fonction as string | null) ?? null)
          : (defaut.fonction ?? null),
        /* Comparaison sur le nom seul : c'est lui qui s'imprime et qui engage
           une personne. Une fonction retouchée sur un nom inchangé reste le
           même problème. */
        estValeurParDefaut: nom.trim() === defaut.nom.trim(),
        enregistre: Boolean(ligne),
      };
    });

    /* ---- Complétude des dossiers ------------------------------------------ */
    /*
       NON restreinte au périmètre : « les dossiers sont-ils complets » décrit
       l'état de la saisie, pas celui d'une promotion. Un champ manquant reste
       manquant qu'on regarde une classe ou l'école entière.
    */
    const dossierRows = await safeRows<Row>(
      client,
      `SELECT COUNT(*)::int AS etudiants,
              COUNT(*) FILTER (WHERE sp.date_of_birth IS NULL)::int AS sans_naissance,
              COUNT(*) FILTER (WHERE sp.place_of_birth IS NULL
                                  OR TRIM(sp.place_of_birth) = '')::int AS sans_lieu,
              COUNT(*) FILTER (WHERE sp.student_matricule IS NULL
                                  OR TRIM(sp.student_matricule) = '')::int AS sans_matricule
         FROM student_profiles sp
        WHERE sp.tenant_id = $1::uuid AND sp.status = 'active'`,
      [tenantId],
      log,
      "dossiers"
    );
    const dos = dossierRows[0] ?? {};

    const pipeline = pipelineRows.map((r) => ({
      diplomaId: String(r.diploma_id),
      code: String(r.code ?? ""),
      libelle: String(r.libelle ?? ""),
      filiereName: (r.filiere_name as string | null) ?? null,
      uvRequises: Math.round(num(r.uv_required)),
      candidats: Math.round(num(r.candidats)),
      eligibles: Math.round(num(r.eligibles)),
      octroyes: Math.round(num(r.octroyes)),
      revoques: Math.round(num(r.revoques)),
      eligiblesNonDiplomes: Math.round(num(r.eligibles_non_diplomes)),
      octroyesSansUv: Math.round(num(r.octroyes_sans_uv)),
    }));

    return {
      computedAt: new Date().toISOString(),
      kpis: {
        diplomesDefinis: pipeline.length,
        candidats: pipeline.reduce((t, p) => t + p.candidats, 0),
        eligibles: pipeline.reduce((t, p) => t + p.eligibles, 0),
        octroyes: pipeline.reduce((t, p) => t + p.octroyes, 0),
        eligiblesNonDiplomes: pipeline.reduce((t, p) => t + p.eligiblesNonDiplomes, 0),
        octroyesSansUv: pipeline.reduce((t, p) => t + p.octroyesSansUv, 0),
      },
      pipeline,
      signataires,
      signatairesParDefaut: signataires.filter((s) => s.estValeurParDefaut).length,
      dossiers: {
        etudiants: Math.round(num(dos.etudiants)),
        sansDateNaissance: Math.round(num(dos.sans_naissance)),
        sansLieuNaissance: Math.round(num(dos.sans_lieu)),
        sansMatricule: Math.round(num(dos.sans_matricule)),
      },
      attestations: {
        /* Toujours false aujourd'hui, et le restera jusqu'à une migration. Le
           champ existe pour que l'écran l'annonce au lieu d'un zéro trompeur. */
        mesurable: false,
        raison:
          "Aucune table d'attestations : elles sont recalculées à chaque génération, sans date d'émission ni compteur. Le volume émis n'est pas mesurable sans migration.",
      },
      anneeScolaire: query.anneeScolaire ?? null,
      filiereIds: filiereIds ?? [],
      nomClasse,
    };
  } finally {
    client.release();
  }
}

/** Export : le pipeline, tel qu'affiché. */
export function buildOwnerDocumentsCsv(data: OwnerDocumentsResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];

  lines.push("Documents officiels — pipeline de diplomation");
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
  lines.push("");

  lines.push(
    "Diplôme;Filière;UV requises;Candidats;Éligibles;Octroyés;Révoqués;Éligibles non diplômés;Octrois sans les UV"
  );
  for (const p of data.pipeline) {
    lines.push(
      [
        esc(`${p.code} — ${p.libelle}`),
        esc(p.filiereName ?? ""),
        p.uvRequises,
        p.candidats,
        p.eligibles,
        p.octroyes,
        p.revoques,
        p.eligiblesNonDiplomes,
        p.octroyesSansUv,
      ].join(";")
    );
  }

  lines.push("");
  lines.push("Signataires des documents officiels");
  lines.push("Titre;Nom;Fonction;Valeur par défaut;Enregistré en base");
  for (const s of data.signataires) {
    lines.push(
      [
        esc(s.cle),
        esc(s.nom),
        esc((s.fonction ?? "").replace(/\n/g, " / ")),
        s.estValeurParDefaut ? "OUI" : "non",
        s.enregistre ? "oui" : "non",
      ].join(";")
    );
  }
  if (data.signatairesParDefaut > 0) {
    lines.push("");
    lines.push(
      esc(
        `ATTENTION : ${data.signatairesParDefaut} signataire(s) portent encore le nom livré par défaut avec l'application. Ce sont des personnes réelles, étrangères à cet établissement, dont le nom s'imprime sur les diplômes.`
      )
    );
  }

  lines.push("");
  lines.push("Complétude des dossiers;Valeur");
  lines.push(`Étudiants actifs;${data.dossiers.etudiants}`);
  lines.push(`Sans date de naissance;${data.dossiers.sansDateNaissance}`);
  lines.push(`Sans lieu de naissance;${data.dossiers.sansLieuNaissance}`);
  lines.push(`Sans matricule;${data.dossiers.sansMatricule}`);

  lines.push("");
  lines.push("Attestations;" + esc(data.attestations.raison ?? "Non mesurable"));

  return lines.join("\n");
}
