import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerCharge,
  OwnerChargeCreateBody,
  OwnerChargePatchBody,
  OwnerChargesQuery,
  OwnerChargesResponse,
} from "@ecoledigitale/contracts";
import { anneeDe } from "./owner-pro-annee.sql";

/**
 * Saisie et lecture des charges de l'établissement.
 *
 * CE SERVICE ÉCRIT, ET C'EST UNE EXCEPTION
 *
 * L'espace propriétaire lit des états ; il ne saisit rien, sauf ici. La raison
 * est que les charges n'existent nulle part ailleurs dans l'application : la
 * table `expenses` (migration 0098) n'a jamais eu d'écran, et l'écran
 * Rentabilité ne pouvait donc afficher qu'un chiffre d'affaires. Tant qu'aucune
 * charge n'est saisie, il refuse d'écrire le mot « marge » — ce service est ce
 * qui lui permet de l'écrire un jour.
 *
 * LA RÈGLE QUI NE SE NÉGOCIE PAS
 *
 * Une charge d'établissement — loyer, énergie, amortissement — n'est JAMAIS
 * répartie entre les classes. Aucune clé de répartition n'est inventée ici, ni
 * au prorata des effectifs, ni à celui du chiffre d'affaires. Elle est totalisée
 * à part et présentée en pied de tableau. Une marge par filière qui absorbe une
 * quote-part de loyer inventée n'est pas une marge, c'est une opinion.
 */

/**
 * Niveau de rattachement, déduit des colonnes renseignées.
 *
 * Le SQL le calcule pour que l'écran n'ait pas à refaire ce raisonnement, et
 * surtout pour que les totaux par niveau et l'étiquette de chaque ligne
 * viennent de la même source.
 */
const NIVEAU_SQL = `
  CASE WHEN e.classe_nom_id IS NOT NULL THEN 'cohorte'
       WHEN e.programme_id  IS NOT NULL THEN 'classe'
       ELSE 'etablissement' END`;

/**
 * Exercice d'imputation d'une charge.
 *
 * La colonne explicite ne sert qu'à DÉROGER : une charge engagée en août pour
 * la rentrée de septembre appartient à l'exercice qui s'ouvre, pas à celui qui
 * se ferme. Sans dérogation, le pivot septembre s'applique à `incurred_on`,
 * comme partout ailleurs dans l'espace propriétaire.
 *
 * Alias attendu : `e` = expenses.
 */
export const ANNEE_CHARGE_SQL = `COALESCE(e.annee_scolaire, ${anneeDe("e.incurred_on")})`;

/** Colonnes d'une ligne de charge, jointures comprises. */
const SELECT_CHARGE = `
  SELECT e.id,
         e.category_id                         AS categorie_id,
         c.libelle                             AS categorie_libelle,
         e.libelle,
         e.amount::float8                      AS montant,
         e.currency                            AS devise,
         e.incurred_on::text                   AS engage_le,
         e.paid_on::text                       AS paye_le,
         e.supplier                            AS fournisseur,
         e.notes,
         e.programme_id,
         p.name                                AS programme_nom,
         e.classe_nom_id,
         cn.nom                                AS classe_nom,
         ${ANNEE_CHARGE_SQL}                   AS annee_scolaire,
         ${NIVEAU_SQL}                         AS niveau
    FROM expenses e
    LEFT JOIN expense_categories c       ON c.id = e.category_id     AND c.tenant_id = e.tenant_id
    LEFT JOIN programmes p               ON p.id = e.programme_id    AND p.tenant_id = e.tenant_id
    LEFT JOIN professional_classe_noms cn ON cn.id = e.classe_nom_id AND cn.tenant_id = e.tenant_id`;

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toCharge(r: Row): OwnerCharge {
  return {
    id: String(r.id),
    categorieId: r.categorie_id ? String(r.categorie_id) : null,
    categorieLibelle: r.categorie_libelle ? String(r.categorie_libelle) : null,
    libelle: String(r.libelle),
    montant: num(r.montant),
    devise: String(r.devise ?? "XOF"),
    engageLe: String(r.engage_le),
    payeLe: r.paye_le ? String(r.paye_le) : null,
    fournisseur: r.fournisseur ? String(r.fournisseur) : null,
    notes: r.notes ? String(r.notes) : null,
    programmeId: r.programme_id ? String(r.programme_id) : null,
    programmeNom: r.programme_nom ? String(r.programme_nom) : null,
    classeNomId: r.classe_nom_id ? String(r.classe_nom_id) : null,
    classeNom: r.classe_nom ? String(r.classe_nom) : null,
    anneeScolaire: r.annee_scolaire ? String(r.annee_scolaire) : null,
    niveau: String(r.niveau) as OwnerCharge["niveau"],
  };
}

/**
 * Filtre de périmètre des charges.
 *
 * IL DIFFÈRE DE `owner-perimetre.sql`, ET C'EST VOULU. Le socle commun part des
 * OUVERTURES de classe ; une charge, elle, n'ouvre rien : elle porte sa classe
 * et son exercice en propre. Les deux se rejoignent sur le vocabulaire — même
 * année, même classe — sans partager le même chemin de jointure.
 *
 * LE NON-DIT QUI COMPTE : une charge d'établissement (ni classe ni cohorte) ne
 * sort PAS du périmètre quand on filtre par classe. Elle reste visible, sous
 * son propre libellé. La retirer laisserait croire qu'une classe filtrée ne
 * supporte aucun frais fixe ; la répartir inventerait une clé. On la montre, et
 * on dit qu'elle n'est pas ventilée.
 *
 * $1 tenant, $2 année, $3 filières, $4 nom de classe, $5 catégorie, $6 état.
 */
const FILTRE_SQL = `
   WHERE e.tenant_id = $1::uuid
     AND ($2::text   IS NULL OR ${ANNEE_CHARGE_SQL} = $2::text)
     AND ($3::uuid[] IS NULL OR e.programme_id IS NULL OR e.programme_id = ANY($3::uuid[]))
     AND ($4::text   IS NULL OR e.classe_nom_id IS NULL OR cn.nom = $4::text)
     AND ($5::uuid   IS NULL OR e.category_id = $5::uuid)
     AND ($6::text = 'tous'
          OR ($6::text = 'paye'   AND e.paid_on IS NOT NULL)
          OR ($6::text = 'engage' AND e.paid_on IS NULL))`;

/**
 * Le nom de classe, extrait de la clé « filiereId|nom » de la barre de filtres.
 *
 * Les charges ne connaissent pas cette clé composite : elles portent un
 * `classe_nom_id` qui pointe déjà une classe précise. On ne garde donc que le
 * libellé, la filière étant déjà couverte par `filiereIds`.
 */
function nomSeul(nomClasse: string | null | undefined): string | null {
  if (!nomClasse) return null;
  const i = nomClasse.indexOf("|");
  return i >= 0 ? nomClasse.slice(i + 1) : nomClasse;
}

export async function fetchOwnerCharges(
  pool: Pool,
  tenantId: string,
  query: OwnerChargesQuery,
  log: FastifyBaseLogger
): Promise<OwnerChargesResponse> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const params = [
    tenantId,
    query.anneeScolaire ?? null,
    query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null,
    nomSeul(query.nomClasse),
    query.categorieId ?? null,
    query.paye ?? "tous",
  ];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /*
       Les totaux portent sur TOUT le périmètre, pas sur la page : une somme de
       page se lit comme une somme tout court, et c'est le défaut que l'espace
       propriétaire corrige partout ailleurs.
    */
    const totaux = await client.query(
      `SELECT COUNT(*)::int                                        AS nombre,
              COALESCE(SUM(e.amount), 0)::float8                   AS montant,
              COALESCE(SUM(e.amount) FILTER (WHERE e.paid_on IS NOT NULL), 0)::float8 AS montant_paye,
              COALESCE(SUM(e.amount) FILTER (WHERE e.paid_on IS NULL), 0)::float8     AS montant_engage,
              COALESCE(SUM(e.amount) FILTER (WHERE e.classe_nom_id IS NOT NULL), 0)::float8 AS montant_cohorte,
              COALESCE(SUM(e.amount) FILTER (WHERE e.classe_nom_id IS NULL
                                               AND e.programme_id IS NOT NULL), 0)::float8  AS montant_classe,
              COALESCE(SUM(e.amount) FILTER (WHERE e.programme_id IS NULL), 0)::float8      AS montant_etablissement
         FROM expenses e
         LEFT JOIN professional_classe_noms cn ON cn.id = e.classe_nom_id AND cn.tenant_id = e.tenant_id
       ${FILTRE_SQL}`,
      params
    );

    const rows = await client.query(
      `${SELECT_CHARGE}
       ${FILTRE_SQL}
       ORDER BY e.incurred_on DESC, e.created_at DESC
       LIMIT $7 OFFSET $8`,
      [...params, pageSize, (page - 1) * pageSize]
    );

    const t = (totaux.rows[0] ?? {}) as Row;
    return {
      rows: rows.rows.map(toCharge),
      totaux: {
        nombre: Math.round(num(t.nombre)),
        montant: num(t.montant),
        montantPaye: num(t.montant_paye),
        montantEngage: num(t.montant_engage),
        montantCohorte: num(t.montant_cohorte),
        montantClasse: num(t.montant_classe),
        montantEtablissement: num(t.montant_etablissement),
      },
      page,
      pageSize,
      totalCount: Math.round(num(t.nombre)),
    };
  } catch (e) {
    log.error({ err: e }, "owner charges list failed");
    throw e;
  } finally {
    client.release();
  }
}

export async function fetchOwnerChargeCategories(
  pool: Pool,
  tenantId: string
): Promise<{ categories: Array<{ id: string; code: string; libelle: string; estFixe: boolean }> }> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const r = await client.query(
      `SELECT id, code, libelle, COALESCE(est_fixe, false) AS est_fixe
         FROM expense_categories
        WHERE tenant_id = $1::uuid
        ORDER BY est_fixe DESC, libelle`,
      [tenantId]
    );
    return {
      categories: r.rows.map((x: Row) => ({
        id: String(x.id),
        code: String(x.code),
        libelle: String(x.libelle),
        estFixe: Boolean(x.est_fixe),
      })),
    };
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/*  Écriture                                                                   */
/* -------------------------------------------------------------------------- */

/** Relit la ligne écrite, pour renvoyer exactement ce que la base contient. */
async function relire(client: PoolClient, tenantId: string, id: string): Promise<OwnerCharge | null> {
  const r = await client.query(`${SELECT_CHARGE} WHERE e.tenant_id = $1::uuid AND e.id = $2::uuid`, [
    tenantId,
    id,
  ]);
  return r.rows[0] ? toCharge(r.rows[0] as Row) : null;
}

/**
 * Erreur métier d'écriture, à traduire en 400 par la route.
 *
 * Les contraintes de la migration 0128 disent la même chose, mais en SQLSTATE :
 * un comptable à qui l'on répond « 23514 » ne sait pas quoi corriger.
 */
export class OwnerChargeInvalide extends Error {}

/**
 * Vérifie que la cohorte visée appartient bien à la classe déclarée.
 *
 * La clé étrangère composite le garantit déjà, mais elle échoue en 23503 sans
 * dire laquelle des deux valeurs est en cause. Ce contrôle-ci permet un message
 * qui nomme le problème.
 */
async function verifierCohorte(
  client: PoolClient,
  tenantId: string,
  classeNomId: string | null | undefined,
  programmeId: string | null | undefined
): Promise<void> {
  if (!classeNomId) return;
  const r = await client.query(
    `SELECT 1 FROM professional_classe_noms
      WHERE tenant_id = $1::uuid AND id = $2::uuid AND classe_id = $3::uuid`,
    [tenantId, classeNomId, programmeId ?? null]
  );
  if (r.rowCount === 0) {
    throw new OwnerChargeInvalide(
      "Cette cohorte n'appartient pas à la classe choisie. Sélectionnez d'abord la classe, puis l'une de ses cohortes."
    );
  }
}

export async function createOwnerCharge(
  pool: Pool,
  tenantId: string,
  body: OwnerChargeCreateBody,
  userId: string | null,
  log: FastifyBaseLogger
): Promise<OwnerCharge> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await verifierCohorte(client, tenantId, body.classeNomId, body.programmeId);

    const r = await client.query(
      `INSERT INTO expenses
         (id, tenant_id, category_id, programme_id, classe_nom_id, annee_scolaire,
          libelle, amount, currency, incurred_on, paid_on, supplier, notes, created_by)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
               $6::text, $7::numeric, $8::text, $9::date, $10::date, $11::text, $12::text, $13::uuid)
       RETURNING id`,
      [
        tenantId,
        body.categorieId ?? null,
        body.programmeId ?? null,
        body.classeNomId ?? null,
        body.anneeScolaire ?? null,
        body.libelle,
        body.montant,
        body.devise ?? "XOF",
        body.engageLe,
        body.payeLe ?? null,
        body.fournisseur ?? null,
        body.notes ?? null,
        userId,
      ]
    );
    const charge = await relire(client, tenantId, String(r.rows[0].id));
    if (!charge) throw new Error("Charge introuvable après création");
    return charge;
  } catch (e) {
    log.error({ err: e }, "owner charge create failed");
    throw e;
  } finally {
    client.release();
  }
}

/** Champs modifiables, et leur colonne. Tout le reste est ignoré. */
const COLONNES: Array<[keyof OwnerChargePatchBody, string, string]> = [
  ["categorieId", "category_id", "uuid"],
  ["programmeId", "programme_id", "uuid"],
  ["classeNomId", "classe_nom_id", "uuid"],
  ["anneeScolaire", "annee_scolaire", "text"],
  ["libelle", "libelle", "text"],
  ["montant", "amount", "numeric"],
  ["devise", "currency", "text"],
  ["engageLe", "incurred_on", "date"],
  ["payeLe", "paid_on", "date"],
  ["fournisseur", "supplier", "text"],
  ["notes", "notes", "text"],
];

export async function updateOwnerCharge(
  pool: Pool,
  tenantId: string,
  id: string,
  body: OwnerChargePatchBody,
  log: FastifyBaseLogger
): Promise<OwnerCharge | null> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /*
       Le rattachement se vérifie sur la ligne TELLE QU'ELLE SERA, pas telle
       qu'elle est : une mise à jour partielle peut ne changer que la cohorte,
       la classe restant celle déjà en base.
    */
    const actuel = await relire(client, tenantId, id);
    if (!actuel) return null;
    const classeNomId = "classeNomId" in body ? body.classeNomId : actuel.classeNomId;
    const programmeId = "programmeId" in body ? body.programmeId : actuel.programmeId;
    await verifierCohorte(client, tenantId, classeNomId, programmeId);

    const sets: string[] = [];
    const args: unknown[] = [tenantId, id];
    for (const [champ, colonne, type] of COLONNES) {
      if (!(champ in body)) continue;
      args.push((body as Record<string, unknown>)[champ] ?? null);
      sets.push(`${colonne} = $${args.length}::${type}`);
    }
    if (sets.length === 0) return actuel;

    const r = await client.query(
      `UPDATE expenses SET ${sets.join(", ")}, updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid
        RETURNING id`,
      args
    );
    if (r.rowCount === 0) return null;
    return await relire(client, tenantId, id);
  } catch (e) {
    log.error({ err: e }, "owner charge update failed");
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteOwnerCharge(
  pool: Pool,
  tenantId: string,
  id: string,
  log: FastifyBaseLogger
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const r = await client.query(
      `DELETE FROM expenses WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, id]
    );
    return (r.rowCount ?? 0) > 0;
  } catch (e) {
    log.error({ err: e }, "owner charge delete failed");
    throw e;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/*  Cohortes rattachables                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Les cohortes déclarées pour une classe.
 *
 * POURQUOI CETTE ROUTE PLUTÔT QUE LE RÉFÉRENTIEL DE FILTRES
 *
 * `/owner/stats/filters` expose bien des « noms de classe », mais ils sont
 * DÉRIVÉS du libellé des ouvertures, et leur clé est la chaîne
 * « filiereId|nom ». La clé étrangère d'une charge, elle, pointe l'UUID d'une
 * ligne de `professional_classe_noms`, qui est une table DÉCLARATIVE : sur cette
 * base, trois lignes pour quarante et une classes. Les deux ensembles ne
 * coïncident pas, et proposer au comptable un nom que la contrainte refusera
 * ensuite serait lui faire perdre son temps sur une erreur qu'il ne peut pas
 * comprendre.
 *
 * Cette route ne renvoie donc QUE ce à quoi une charge peut réellement se
 * rattacher. Une classe sans cohorte déclarée rend une liste vide, et l'écran
 * le dit.
 */
export async function fetchOwnerChargeCohortes(
  pool: Pool,
  tenantId: string,
  programmeId: string | null
): Promise<{ cohortes: Array<{ id: string; nom: string; programmeId: string }> }> {
  if (!programmeId) return { cohortes: [] };
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const r = await client.query(
      `SELECT cn.id, cn.nom, cn.classe_id
         FROM professional_classe_noms cn
        WHERE cn.tenant_id = $1::uuid AND cn.classe_id = $2::uuid
        ORDER BY cn.nom`,
      [tenantId, programmeId]
    );
    return {
      cohortes: r.rows.map((x: Row) => ({
        id: String(x.id),
        nom: String(x.nom),
        programmeId: String(x.classe_id),
      })),
    };
  } finally {
    client.release();
  }
}
