import type { PoolClient } from "pg";
import type {
  CreateCommercialInput,
  ProvenanceInput,
  ProvenanceQuery,
  ProspectionDashboardQuery,
  UpdateCommercialInput,
} from "@ecoledigitale/contracts";
import { canalDemandeDetail } from "@ecoledigitale/contracts";
import { ProfessionalBaseService, fail, ok, type ServiceResult } from "./professional-base.service";

/**
 * Prospection — provenance des étudiants, commerciaux et commissions
 * (migrations `0120`, `0124`, `0125`).
 *
 * Règle unique de calcul : la commission d'un commercial est le taux figé sur
 * la provenance de l'étudiant, appliqué aux paiements de scolarité CONFIRMÉS de
 * cet étudiant. Rien n'est dû sur un impayé, et un remboursement retire
 * mécaniquement sa part — c'est pourquoi aucun montant n'est stocké.
 *
 * Assiette : la LIGNE « SCOLARITÉ » du barème encaissé — l'écran
 * /admin/finances/scolarite et sa caisse /admin/finances/student-payments. Le
 * barème compte quatre lignes (inscription, scolarité, frais annexes, autres
 * frais) ; seule la scolarité ouvre droit à commission, conformément à
 * « commission sur les frais de scolarité ». Les frais d'inscription et les
 * frais annexes n'en donnent aucune.
 *
 * En base, cette ligne correspond aux commandes de nature `ue` ou `scolarite`
 * — même correspondance que `ligneOfNature` dans professional-payment.service.
 * Le complément `scolarite` existe précisément pour que `ue + scolarite` égale
 * `cycles_frais.scolarite`, le montant saisi sur l'écran du barème : les deux
 * natures ensemble SONT la ligne Scolarité, ni plus ni moins.
 *
 * La conduite (`transversal`) est une UE sans prix — notée et moyennée, jamais
 * facturée. Ses commandes historiques et leurs paiements restent en base avec
 * leurs reçus (cf. `infra/scripts/fix-conduite-non-payante.sql`) mais n'entrent
 * dans aucune commission, comme ils n'entrent dans aucune ligne de barème.
 */

/** Montant en FCFA, arrondi à l'unité — la devise n'a pas de subdivision. */
export function commissionDue(totalPaye: number, taux: number | null | undefined): number {
  if (taux == null || !Number.isFinite(taux) || !Number.isFinite(totalPaye)) return 0;
  if (totalPaye <= 0 || taux <= 0) return 0;
  return Math.round((totalPaye * taux) / 100);
}

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Scolarité encaissée par étudiant : la ligne « Scolarité » du barème, réglée
 * et confirmée. `ue` et `scolarite` sont les deux natures qui l'alimentent ;
 * `inscription`, `annexes` et `autres` sont d'autres lignes, `transversal`
 * (la conduite) n'est pas facturable, et une commande annulée n'a rien encaissé.
 */
const PAIEMENTS_PAR_ETUDIANT_CTE = `
  paiements_par_etudiant AS (
    SELECT po.student_id,
           COALESCE(SUM(pp.montant), 0)::float8 AS total_paye
      FROM professional_payments pp
      JOIN professional_orders po
        ON po.id = pp.order_id AND po.tenant_id = pp.tenant_id
     WHERE pp.tenant_id = $1::uuid
       AND pp.statut = 'confirme'
       AND po.statut <> 'annulee'
       AND po.nature IN ('ue', 'scolarite')
     GROUP BY po.student_id
  )`;

/**
 * UNE LIGNE PAR PAIEMENT de scolarité ouvrant droit à commission : c'est la
 * maille de référence du module depuis la migration 0125. Le solde d'un
 * commercial, le détail de ses étudiants et le tableau de bord s'en déduisent
 * tous, de sorte qu'ils ne peuvent pas se contredire.
 *
 * L'arrondi est fait PAIEMENT PAR PAIEMENT, jamais sur un cumul : c'est ligne
 * par ligne qu'on règle, et une somme d'arrondis ne vaut pas l'arrondi de la
 * somme. Paramètre attendu : `$1` = tenant.
 */
const LIGNES_COMMISSION_CTE = `
  lignes_commission AS (
    SELECT pp.id AS payment_id,
           prov.commercial_id,
           prov.student_id,
           pp.montant::float8 AS montant_scolarite,
           ROUND((pp.montant * prov.taux_commission / 100)::numeric)::float8 AS commission
      FROM professional_payments pp
      JOIN professional_orders po
        ON po.id = pp.order_id AND po.tenant_id = pp.tenant_id
      JOIN student_provenances prov
        ON prov.student_id = po.student_id AND prov.tenant_id = pp.tenant_id
       AND prov.canal = 'commercial'
     WHERE pp.tenant_id = $1::uuid
       AND pp.statut = 'confirme'
       AND po.statut <> 'annulee'
       AND po.nature IN ('ue', 'scolarite')
  )`;

/** Nom affichable d'un étudiant, à partir de sa fiche utilisateur. */
const NOM_ETUDIANT_SQL = `
  NULLIF(BTRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')`;

/**
 * Matricule IPAM de l'étudiant — `IPAM-<CODE CLASSE>-<NNNN>`, attribué à
 * l'inscription au module professionnel (migration 0093). C'est celui qui
 * figure sur les bulletins et les attestations, et donc celui qu'attend
 * l'administration.
 *
 * Surtout PAS `student_profiles.student_matricule` (« ETU-2026-046 ») ni
 * `establishment_matricule` : ce sont les identifiants de la fiche scolaire,
 * qui ne désignent pas l'étudiant dans le module professionnel.
 *
 * Un étudiant en a un par classe ; on retient le plus récent. Il est nul tant
 * qu'aucune inscription n'a été enregistrée.
 */
const MATRICULE_SQL = `
  (SELECT psm.matricule
     FROM professional_student_matricules psm
    WHERE psm.student_id = sp.id AND psm.tenant_id = sp.tenant_id
    ORDER BY psm.created_at DESC
    LIMIT 1)`;

export class ProspectionService extends ProfessionalBaseService {
  // -------------------------------------------------------------------------
  // Commerciaux
  // -------------------------------------------------------------------------

  async listCommerciaux(tenantId: string): Promise<ServiceResult<unknown[]>> {
    return this.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT c.id,
                c.nom,
                c.telephone,
                c.email,
                c.taux_commission::float8 AS taux_commission,
                c.actif,
                c.note,
                c.created_at,
                COUNT(prov.id)::int AS etudiants
           FROM commerciaux c
           LEFT JOIN student_provenances prov
             ON prov.commercial_id = c.id AND prov.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1::uuid
          GROUP BY c.id
          ORDER BY c.actif DESC, c.nom`,
        [tenantId]
      );
      return ok(
        rows.map((row) => ({
          ...row,
          taux_commission: num(row.taux_commission),
          created_at: row.created_at?.toISOString?.() ?? row.created_at,
        }))
      );
    });
  }

  async createCommercial(
    tenantId: string,
    input: CreateCommercialInput
  ): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, async (client) => {
      const exists = await client.query(
        `SELECT 1 FROM commerciaux WHERE tenant_id = $1::uuid AND LOWER(nom) = LOWER($2)`,
        [tenantId, input.nom]
      );
      if (exists.rowCount) {
        return fail("COMMERCIAL_DUPLICATE", `Un commercial nommé « ${input.nom} » existe déjà.`);
      }
      const { rows } = await client.query(
        `INSERT INTO commerciaux (tenant_id, nom, telephone, email, taux_commission, note)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)
         RETURNING id, nom, telephone, email, taux_commission::float8 AS taux_commission,
                   actif, note, created_at`,
        [
          tenantId,
          input.nom,
          input.telephone || null,
          input.email || null,
          input.taux_commission,
          input.note || null,
        ]
      );
      return ok({ ...rows[0], taux_commission: num(rows[0].taux_commission), etudiants: 0 });
    });
  }

  async updateCommercial(
    tenantId: string,
    id: string,
    input: UpdateCommercialInput
  ): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, async (client) => {
      const current = await client.query(
        `SELECT id FROM commerciaux WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, id]
      );
      if (!current.rowCount) return fail("COMMERCIAL_NOT_FOUND", "Commercial introuvable.");

      if (input.nom) {
        const clash = await client.query(
          `SELECT 1 FROM commerciaux
            WHERE tenant_id = $1::uuid AND LOWER(nom) = LOWER($2) AND id <> $3::uuid`,
          [tenantId, input.nom, id]
        );
        if (clash.rowCount) {
          return fail("COMMERCIAL_DUPLICATE", `Un commercial nommé « ${input.nom} » existe déjà.`);
        }
      }

      const { rows } = await client.query(
        `UPDATE commerciaux
            SET nom = COALESCE($3, nom),
                telephone = COALESCE($4, telephone),
                email = COALESCE($5, email),
                taux_commission = COALESCE($6, taux_commission),
                actif = COALESCE($7, actif),
                note = COALESCE($8, note)
          WHERE tenant_id = $1::uuid AND id = $2::uuid
          RETURNING id, nom, telephone, email, taux_commission::float8 AS taux_commission,
                    actif, note, created_at`,
        [
          tenantId,
          id,
          input.nom ?? null,
          input.telephone ?? null,
          input.email || null,
          input.taux_commission ?? null,
          input.actif ?? null,
          input.note ?? null,
        ]
      );
      return ok({ ...rows[0], taux_commission: num(rows[0].taux_commission) });
    });
  }

  /**
   * Suppression définitive. Refusée dès qu'un étudiant ou un règlement s'y
   * rattache : la commission déjà due ne doit pas disparaître d'un écran.
   * Pour retirer un commercial du choix, on le désactive.
   */
  async deleteCommercial(tenantId: string, id: string): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM student_provenances
             WHERE tenant_id = $1::uuid AND commercial_id = $2::uuid)::int AS etudiants,
           (SELECT COUNT(*) FROM commissions_versements
             WHERE tenant_id = $1::uuid AND commercial_id = $2::uuid)::int AS versements`,
        [tenantId, id]
      );
      const { etudiants, versements } = rows[0];
      if (etudiants > 0 || versements > 0) {
        return fail(
          "COMMERCIAL_IN_USE",
          `Ce commercial a ${etudiants} étudiant(s) et ${versements} règlement(s) rattachés. Désactivez-le plutôt que de le supprimer.`
        );
      }
      const res = await client.query(
        `DELETE FROM commerciaux WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, id]
      );
      if (!res.rowCount) return fail("COMMERCIAL_NOT_FOUND", "Commercial introuvable.");
      return ok({ deleted: true });
    });
  }

  // -------------------------------------------------------------------------
  // Provenance des étudiants
  // -------------------------------------------------------------------------

  /**
   * Les provenances ENREGISTRÉES, une par ligne. La liste part donc vide et se
   * remplit au fil des inscriptions : un étudiant sans provenance n'est pas un
   * trou à combler — tous ne sont pas passés par quelqu'un.
   *
   * Le filtre `non_renseigne` fait exception et renvoie la liste inverse, les
   * étudiants sans provenance, pour rattraper une saisie oubliée.
   */
  async listProvenances(
    tenantId: string,
    query: ProvenanceQuery & { limit?: number; offset?: number }
  ): Promise<ServiceResult<unknown>> {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
    const offset = Math.max(query.offset ?? 0, 0);

    return this.withTenant(tenantId, async (client) => {
      const filtres: string[] = [];
      const params: unknown[] = [tenantId, query.search?.trim() || null];

      // Un étudiant précis est toujours renvoyé, provenance ou non : c'est ce
      // qui permet à sa fiche d'afficher « non renseignée » plutôt que rien.
      if (query.student_id) {
        params.push(query.student_id);
        filtres.push(`sp.id = $${params.length}::uuid`);
      }

      // Par défaut, seules les provenances saisies figurent dans la liste.
      if (query.canal === "non_renseigne") filtres.push("prov.id IS NULL");
      else if (query.canal) {
        params.push(query.canal);
        filtres.push(`prov.canal = $${params.length}`);
      } else if (!query.student_id) filtres.push("prov.id IS NOT NULL");

      if (query.commercial_id) {
        params.push(query.commercial_id);
        filtres.push(`prov.commercial_id = $${params.length}::uuid`);
      }

      const where = filtres.length ? `AND ${filtres.join(" AND ")}` : "";

      const sql = `
        WITH ${PAIEMENTS_PAR_ETUDIANT_CTE},
        ${LIGNES_COMMISSION_CTE},
        commission_par_etudiant AS (
          SELECT student_id, SUM(commission)::float8 AS commission
            FROM lignes_commission
           GROUP BY student_id
        )
        SELECT sp.id AS student_id,
               COALESCE(${NOM_ETUDIANT_SQL}, u.email, '—') AS student_nom,
               ${MATRICULE_SQL} AS matricule,
               prov.canal,
               prov.commercial_id,
               c.nom AS commercial_nom,
               prov.taux_commission::float8 AS taux_commission,
               prov.referent_nom,
               prov.referent_student_id,
               COALESCE(
                 NULLIF(BTRIM(COALESCE(ru.first_name, '') || ' ' || COALESCE(ru.last_name, '')), ''),
                 ru.email
               ) AS referent_student_nom,
               prov.media_detail,
               prov.note,
               COALESCE(pe.total_paye, 0)::float8 AS total_paye,
               COALESCE(ce.commission, 0)::float8 AS commission,
               prov.created_at AS enregistre_le,
               COUNT(*) OVER ()::int AS total_lignes
          FROM student_profiles sp
          JOIN users u ON u.id = sp.user_id AND u.tenant_id = sp.tenant_id
          LEFT JOIN student_provenances prov
            ON prov.student_id = sp.id AND prov.tenant_id = sp.tenant_id
          LEFT JOIN commerciaux c
            ON c.id = prov.commercial_id AND c.tenant_id = prov.tenant_id
          LEFT JOIN student_profiles rsp
            ON rsp.id = prov.referent_student_id AND rsp.tenant_id = prov.tenant_id
          LEFT JOIN users ru ON ru.id = rsp.user_id AND ru.tenant_id = rsp.tenant_id
          LEFT JOIN paiements_par_etudiant pe ON pe.student_id = sp.id
          LEFT JOIN commission_par_etudiant ce ON ce.student_id = sp.id
         WHERE sp.tenant_id = $1::uuid
           AND (
             $2::text IS NULL
             OR ${NOM_ETUDIANT_SQL} ILIKE '%' || $2 || '%'
             OR u.email ILIKE '%' || $2 || '%'
             OR ${MATRICULE_SQL} ILIKE '%' || $2 || '%'
           )
           ${where}
         ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST
         LIMIT ${limit} OFFSET ${offset}`;

      const { rows } = await client.query(sql, params);

      const items = rows.map((row) => ({
        student_id: row.student_id,
        student_nom: row.student_nom,
        matricule: row.matricule,
        canal: row.canal,
        commercial_id: row.commercial_id,
        commercial_nom: row.commercial_nom,
        taux_commission: row.taux_commission == null ? null : num(row.taux_commission),
        referent_nom: row.referent_nom,
        referent_student_id: row.referent_student_id,
        referent_student_nom: row.referent_student_nom,
        media_detail: row.media_detail,
        note: row.note,
        total_paye: num(row.total_paye),
        // Somme des lignes, comme partout ailleurs : un recalcul sur le cumul
        // donnerait un franc d'écart avec l'écran des commissions.
        commission: row.canal === "commercial" ? num(row.commission) : 0,
        enregistre_le: row.enregistre_le?.toISOString?.() ?? row.enregistre_le ?? null,
      }));

      return ok({
        items,
        total: rows.length ? Number(rows[0].total_lignes) : 0,
        limit,
        offset,
      });
    });
  }

  async setProvenance(
    tenantId: string,
    studentId: string,
    input: ProvenanceInput,
    userId: string | null
  ): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, (client) =>
      this.upsertProvenance(client, tenantId, studentId, input, userId)
    );
  }

  /**
   * Enregistrement en lot depuis la page Inscriptions. Une entrée refusée
   * n'annule pas les autres : l'administration voit ce qui est passé et ce qui
   * reste à reprendre, plutôt que de tout ressaisir.
   */
  async setProvenancesBulk(
    tenantId: string,
    entrees: Array<{ student_id: string; provenance: ProvenanceInput }>,
    userId: string | null
  ): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, async (client) => {
      let enregistrees = 0;
      const erreurs: Array<{ student_id: string; message: string }> = [];

      for (const entree of entrees) {
        const result = await this.upsertProvenance(
          client,
          tenantId,
          entree.student_id,
          entree.provenance,
          userId
        );
        if (result.success) enregistrees += 1;
        else erreurs.push({ student_id: entree.student_id, message: result.message });
      }

      return ok({ enregistrees, erreurs });
    });
  }

  private async upsertProvenance(
    client: PoolClient,
    tenantId: string,
    studentId: string,
    input: ProvenanceInput,
    userId: string | null
  ): Promise<ServiceResult<unknown>> {
    const student = await client.query(
      `SELECT 1 FROM student_profiles WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, studentId]
    );
    if (!student.rowCount) return fail("STUDENT_NOT_FOUND", "Étudiant introuvable.");

    let taux: number | null = null;
    if (input.canal === "commercial") {
      const commercial = await client.query(
        `SELECT taux_commission::float8 AS taux
           FROM commerciaux WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, input.commercial_id]
      );
      if (!commercial.rowCount) return fail("COMMERCIAL_NOT_FOUND", "Commercial introuvable.");
      // Le taux saisi prime ; à défaut, celui du commercial sert de proposition.
      taux = input.taux_commission ?? num(commercial.rows[0].taux);
    }

    if (input.canal === "etudiant" && input.referent_student_id === studentId) {
      return fail("REFERENT_SELF", "Un étudiant ne peut pas être son propre référent.");
    }
    if (input.canal === "etudiant") {
      const referent = await client.query(
        `SELECT 1 FROM student_profiles WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, input.referent_student_id]
      );
      if (!referent.rowCount) return fail("REFERENT_NOT_FOUND", "Étudiant référent introuvable.");
    }

    const { rows } = await client.query(
      `INSERT INTO student_provenances (
         tenant_id, student_id, canal, commercial_id, taux_commission,
         referent_nom, referent_student_id, media_detail, note, created_by
       )
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8, $9, $10::uuid)
       ON CONFLICT (tenant_id, student_id) DO UPDATE
         SET canal = EXCLUDED.canal,
             commercial_id = EXCLUDED.commercial_id,
             taux_commission = EXCLUDED.taux_commission,
             referent_nom = EXCLUDED.referent_nom,
             referent_student_id = EXCLUDED.referent_student_id,
             media_detail = EXCLUDED.media_detail,
             note = EXCLUDED.note
       RETURNING id, student_id, canal, commercial_id,
                 taux_commission::float8 AS taux_commission`,
      [
        tenantId,
        studentId,
        input.canal,
        input.canal === "commercial" ? input.commercial_id : null,
        taux,
        input.canal === "connaissance" ? input.referent_nom?.trim() || null : null,
        input.canal === "etudiant" ? input.referent_student_id : null,
        // Le détail accompagne tout canal qui n'est ni Google, ni Facebook, ni
        // un commercial — cf. `canalDemandeDetail` dans les contrats.
        canalDemandeDetail(input.canal) ? input.media_detail?.trim() || null : null,
        input.note?.trim() || null,
        userId,
      ]
    );

    return ok({
      ...rows[0],
      taux_commission: rows[0].taux_commission == null ? null : num(rows[0].taux_commission),
    });
  }

  async deleteProvenance(tenantId: string, studentId: string): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM student_provenances WHERE tenant_id = $1::uuid AND student_id = $2::uuid`,
        [tenantId, studentId]
      );
      if (!res.rowCount) return fail("PROVENANCE_NOT_FOUND", "Aucune provenance enregistrée.");
      return ok({ deleted: true });
    });
  }

  // -------------------------------------------------------------------------
  // Commissions
  // -------------------------------------------------------------------------

  /**
   * Un commercial par ligne : acquis, déjà versé, reste dû.
   *
   * Pas exposée en HTTP : seul le tableau de bord s'en sert, pour son classement
   * des commerciaux. Les écrans de règlement, eux, lisent les LIGNES.
   */
  private async listCommissions(tenantId: string): Promise<ServiceResult<unknown[]>> {
    return this.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `WITH ${LIGNES_COMMISSION_CTE},
         acquis AS (
           SELECT commercial_id,
                  COALESCE(SUM(montant_scolarite), 0)::float8 AS scolarite,
                  COALESCE(SUM(commission), 0)::float8 AS commission
             FROM lignes_commission
            GROUP BY commercial_id
         ),
         effectif AS (
           SELECT commercial_id, COUNT(*)::int AS etudiants
             FROM student_provenances
            WHERE tenant_id = $1::uuid AND canal = 'commercial'
            GROUP BY commercial_id
         ),
         verse AS (
           SELECT commercial_id, COALESCE(SUM(montant), 0)::float8 AS total
             FROM commissions_versements
            WHERE tenant_id = $1::uuid
            GROUP BY commercial_id
         )
         SELECT c.id AS commercial_id,
                c.nom,
                c.telephone,
                c.actif,
                COALESCE(e.etudiants, 0) AS etudiants,
                COALESCE(a.scolarite, 0)::float8 AS scolarite_encaissee,
                COALESCE(a.commission, 0)::float8 AS commission_acquise,
                COALESCE(v.total, 0)::float8 AS commission_versee
           FROM commerciaux c
           LEFT JOIN acquis a ON a.commercial_id = c.id
           LEFT JOIN effectif e ON e.commercial_id = c.id
           LEFT JOIN verse v ON v.commercial_id = c.id
          WHERE c.tenant_id = $1::uuid
          ORDER BY (COALESCE(a.commission, 0) - COALESCE(v.total, 0)) DESC, c.nom`,
        [tenantId]
      );

      return ok(
        rows.map((row) => {
          const acquise = num(row.commission_acquise);
          const versee = num(row.commission_versee);
          return {
            commercial_id: row.commercial_id,
            nom: row.nom,
            telephone: row.telephone,
            actif: row.actif,
            etudiants: Number(row.etudiants ?? 0),
            scolarite_encaissee: num(row.scolarite_encaissee),
            commission_acquise: acquise,
            commission_versee: versee,
            solde: acquise - versee,
          };
        })
      );
    });
  }

  // -------------------------------------------------------------------------
  // Lignes de commission
  // -------------------------------------------------------------------------

  /**
   * Une ligne par PAIEMENT DE SCOLARITÉ d'un étudiant amené par un commercial.
   *
   * C'est la maille de travail : on ne paie pas « un solde », on paie des
   * encaissements précis. Le montant de la commission est recalculé à chaque
   * lecture (montant du paiement × taux figé sur la fiche de l'étudiant) ; seul
   * le fait qu'elle ait été réglée est stocké.
   *
   * `statut` vaut « regle » dès qu'un règlement pointe ce paiement, « impaye »
   * sinon — même vocabulaire que l'historique de paie des enseignants.
   */
  async listLignesCommission(
    tenantId: string,
    query: { commercial_id?: string; statut?: "regle" | "impaye" }
  ): Promise<ServiceResult<unknown[]>> {
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId];
      const filtres: string[] = [];

      if (query.commercial_id) {
        params.push(query.commercial_id);
        filtres.push(`prov.commercial_id = $${params.length}::uuid`);
      }
      if (query.statut === "regle") filtres.push("v.id IS NOT NULL");
      else if (query.statut === "impaye") filtres.push("v.id IS NULL");

      const where = filtres.length ? `AND ${filtres.join(" AND ")}` : "";

      const { rows } = await client.query(
        `SELECT pp.id AS payment_id,
                pp.montant::float8 AS montant_scolarite,
                pp.paid_at AS paiement_le,
                pp.mode AS mode_scolarite,
                pp.receipt_number,
                sp.id AS student_id,
                COALESCE(${NOM_ETUDIANT_SQL}, u.email, '—') AS student_nom,
                ${MATRICULE_SQL} AS matricule,
                prov.commercial_id,
                c.nom AS commercial_nom,
                prov.taux_commission::float8 AS taux_commission,
                ROUND((pp.montant * prov.taux_commission / 100)::numeric)::float8 AS commission,
                v.id AS reglement_id,
                v.paid_at AS regle_le,
                v.mode AS mode_reglement,
                v.reference AS reference_reglement,
                COALESCE(
                  NULLIF(BTRIM(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), ''),
                  au.email
                ) AS regle_par
           FROM professional_payments pp
           JOIN professional_orders po
             ON po.id = pp.order_id AND po.tenant_id = pp.tenant_id
           JOIN student_provenances prov
             ON prov.student_id = po.student_id AND prov.tenant_id = pp.tenant_id
            AND prov.canal = 'commercial'
           JOIN commerciaux c ON c.id = prov.commercial_id AND c.tenant_id = prov.tenant_id
           JOIN student_profiles sp ON sp.id = po.student_id AND sp.tenant_id = po.tenant_id
           JOIN users u ON u.id = sp.user_id AND u.tenant_id = sp.tenant_id
           LEFT JOIN commissions_versements v
             ON v.payment_id = pp.id AND v.tenant_id = pp.tenant_id
           LEFT JOIN users au ON au.id = v.created_by
          WHERE pp.tenant_id = $1::uuid
            AND pp.statut = 'confirme'
            AND po.statut <> 'annulee'
            AND po.nature IN ('ue', 'scolarite')
            ${where}
          ORDER BY pp.paid_at DESC NULLS LAST, pp.created_at DESC`,
        params
      );

      return ok(
        rows.map((row) => ({
          payment_id: row.payment_id,
          montant_scolarite: num(row.montant_scolarite),
          paiement_le: row.paiement_le?.toISOString?.() ?? row.paiement_le ?? null,
          mode_scolarite: row.mode_scolarite,
          receipt_number: row.receipt_number,
          student_id: row.student_id,
          student_nom: row.student_nom,
          matricule: row.matricule,
          commercial_id: row.commercial_id,
          commercial_nom: row.commercial_nom,
          taux_commission: num(row.taux_commission),
          commission: num(row.commission),
          statut: row.reglement_id ? "regle" : "impaye",
          reglement_id: row.reglement_id,
          regle_le: row.regle_le?.toISOString?.() ?? row.regle_le ?? null,
          mode_reglement: row.mode_reglement,
          reference_reglement: row.reference_reglement,
          regle_par: row.regle_par,
        }))
      );
    });
  }

  // -------------------------------------------------------------------------
  // Règlement des commissions
  // -------------------------------------------------------------------------

  /**
   * Marque des LIGNES DE COMMISSION comme payées — une ligne étant un paiement
   * de scolarité d'un étudiant amené par un commercial.
   *
   * Le montant n'est jamais saisi : il est recalculé ici à partir du paiement
   * et du taux figé sur la fiche de l'étudiant. Laisser l'écran l'envoyer
   * ouvrirait la porte à un règlement qui ne correspond pas à la ligne.
   *
   * Une ligne déjà réglée est ignorée sans faire échouer les autres : cocher
   * deux fois la même n'a pas à bloquer tout un lot.
   */
  async reglerLignesCommission(
    tenantId: string,
    input: { payment_ids: string[]; mode: string; reference?: string | null; paid_at?: string },
    userId: string | null
  ): Promise<ServiceResult<unknown>> {
    const ids = Array.from(new Set(input.payment_ids));
    if (ids.length === 0) return fail("VALIDATION_ERROR", "Aucune ligne sélectionnée.");

    return this.withTenantTx(tenantId, async (client) => {
      // On relit la ligne plutôt que de faire confiance au client : montant du
      // paiement, taux de l'étudiant et commercial à créditer viennent tous de
      // la base, dans la même transaction.
      const { rows } = await client.query(
        `SELECT pp.id AS payment_id,
                prov.commercial_id,
                ROUND((pp.montant * prov.taux_commission / 100)::numeric)::float8 AS commission
           FROM professional_payments pp
           JOIN professional_orders po
             ON po.id = pp.order_id AND po.tenant_id = pp.tenant_id
           JOIN student_provenances prov
             ON prov.student_id = po.student_id AND prov.tenant_id = pp.tenant_id
            AND prov.canal = 'commercial'
          WHERE pp.tenant_id = $1::uuid
            AND pp.id = ANY($2::uuid[])
            AND pp.statut = 'confirme'
            AND po.statut <> 'annulee'
            AND po.nature IN ('ue', 'scolarite')
            AND NOT EXISTS (
              SELECT 1 FROM commissions_versements v
               WHERE v.tenant_id = pp.tenant_id AND v.payment_id = pp.id
            )`,
        [tenantId, ids]
      );

      if (rows.length === 0) {
        return fail(
          "AUCUNE_LIGNE_A_REGLER",
          "Ces lignes sont déjà réglées, ou ne donnent pas droit à commission."
        );
      }

      let montantTotal = 0;
      for (const ligne of rows) {
        montantTotal += num(ligne.commission);
        await client.query(
          `INSERT INTO commissions_versements
             (tenant_id, commercial_id, payment_id, montant, mode, reference, paid_at, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, COALESCE($7::timestamptz, NOW()), $8::uuid)`,
          [
            tenantId,
            ligne.commercial_id,
            ligne.payment_id,
            num(ligne.commission),
            input.mode,
            input.reference || null,
            input.paid_at || null,
            userId,
          ]
        );
      }

      return ok({
        reglees: rows.length,
        ignorees: ids.length - rows.length,
        montant: montantTotal,
      });
    });
  }

  async deleteVersement(tenantId: string, id: string): Promise<ServiceResult<unknown>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM commissions_versements WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, id]
      );
      if (!res.rowCount) return fail("VERSEMENT_NOT_FOUND", "Règlement introuvable.");
      // La ligne de commission correspondante redevient impayée : rien d'autre
      // n'est à défaire, le statut se déduit de l'existence de ce règlement.
      return ok({ deleted: true });
    });
  }

  // -------------------------------------------------------------------------
  // Tableau de bord
  // -------------------------------------------------------------------------

  /**
   * Vue d'ensemble de la prospection.
   *
   * L'axe du temps date l'étudiant par le DÉBUT DE SA PREMIÈRE CLASSE OUVERTE,
   * pas par l'horodatage de sa fiche : sur une base reprise, toutes les fiches
   * portent la même date et la courbe se tasserait sur un seul mois. Même
   * convention que les écrans de trésorerie du propriétaire.
   */
  async dashboard(
    tenantId: string,
    query: ProspectionDashboardQuery
  ): Promise<ServiceResult<unknown>> {
    const dateDebut = query.date_debut || null;
    const dateFin = query.date_fin || null;

    return this.withTenant(tenantId, async (client) => {
      const totals = await client.query(
        `SELECT (SELECT COUNT(*) FROM student_profiles WHERE tenant_id = $1::uuid)::int AS total,
                (SELECT COUNT(*) FROM student_provenances WHERE tenant_id = $1::uuid)::int AS renseignes,
                (SELECT COUNT(*) FROM student_provenances
                  WHERE tenant_id = $1::uuid AND canal = 'commercial')::int AS via_commercial`,
        [tenantId]
      );

      const parCanal = await client.query(
        `WITH ${PAIEMENTS_PAR_ETUDIANT_CTE}
         SELECT prov.canal,
                COUNT(*)::int AS etudiants,
                COALESCE(SUM(COALESCE(pe.total_paye, 0)), 0)::float8 AS scolarite
           FROM student_provenances prov
           LEFT JOIN paiements_par_etudiant pe ON pe.student_id = prov.student_id
          WHERE prov.tenant_id = $1::uuid
          GROUP BY prov.canal
          ORDER BY etudiants DESC`,
        [tenantId]
      );

      const parMois = await client.query(
        `WITH arrivees AS (
           SELECT pe.student_id, MIN(s.date_debut) AS arrivee
             FROM professional_enrollments pe
             JOIN professional_ue_sessions s
               ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
            WHERE pe.tenant_id = $1::uuid AND s.date_debut IS NOT NULL
            GROUP BY pe.student_id
         )
         SELECT to_char(date_trunc('month', a.arrivee), 'YYYY-MM') AS mois,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE prov.canal = 'commercial')::int AS commercial,
                COUNT(*) FILTER (WHERE prov.canal IN ('google', 'facebook', 'autre_media'))::int AS medias,
                COUNT(*) FILTER (WHERE prov.canal IN ('connaissance', 'etudiant'))::int AS bouche_a_oreille,
                COUNT(*) FILTER (WHERE prov.canal = 'autre')::int AS autre
           FROM arrivees a
           JOIN student_provenances prov
             ON prov.student_id = a.student_id AND prov.tenant_id = $1::uuid
          WHERE ($2::date IS NULL OR a.arrivee >= $2::date)
            AND ($3::date IS NULL OR a.arrivee <= $3::date)
          GROUP BY 1
          ORDER BY 1`,
        [tenantId, dateDebut, dateFin]
      );

      const commissions = await this.listCommissions(tenantId);
      const lignes = commissions.success ? (commissions.data as any[]) : [];
      const commissionAcquise = lignes.reduce((s, l) => s + l.commission_acquise, 0);
      const commissionVersee = lignes.reduce((s, l) => s + l.commission_versee, 0);

      const total = Number(totals.rows[0].total ?? 0);
      const renseignes = Number(totals.rows[0].renseignes ?? 0);

      return ok({
        total_etudiants: total,
        renseignes,
        non_renseignes: total - renseignes,
        via_commercial: Number(totals.rows[0].via_commercial ?? 0),
        commission_acquise: commissionAcquise,
        commission_versee: commissionVersee,
        commission_due: commissionAcquise - commissionVersee,
        par_canal: parCanal.rows.map((row) => ({
          canal: row.canal,
          etudiants: Number(row.etudiants ?? 0),
          scolarite_encaissee: num(row.scolarite),
        })),
        par_mois: parMois.rows.map((row) => ({
          mois: row.mois,
          total: Number(row.total ?? 0),
          commercial: Number(row.commercial ?? 0),
          medias: Number(row.medias ?? 0),
          bouche_a_oreille: Number(row.bouche_a_oreille ?? 0),
          autre: Number(row.autre ?? 0),
        })),
        top_commerciaux: lignes.filter((l) => l.etudiants > 0).slice(0, 8),
      });
    });
  }
}
