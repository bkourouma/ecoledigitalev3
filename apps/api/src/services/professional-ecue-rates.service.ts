import type { PoolClient } from "pg";
import type {
  CreateProfessionalEcueHourlyRate,
  UpdateProfessionalEcueHourlyRate,
  ProfessionalEcueHourlyRateQuery,
  EcueRateResolution,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Tarifs horaires par ECUE — feature 031, US3.
 *
 * POURQUOI UNE TABLE DÉDIÉE
 * `course_hourly_rates` (Académique) porte un `course_id` qui référence
 * `courses`. Une ECUE n'est pas un cours : l'y faire entrer imposerait une FK
 * polymorphe ou une colonne supplémentaire avec CHECK d'exclusivité, et
 * obligerait à reconstruire sa contrainte EXCLUDE existante. La table sœur est
 * plus simple et laisse le chemin académique strictement intact.
 *
 * RÉSOLUTION D'UN TARIF (ordre figé, FR-012)
 *   1. tarif (ECUE + enseignant)  — nominatif, prioritaire
 *   2. tarif (ECUE, générique)
 *   3. teacher_payment_configs.default_hourly_rate
 * Aucun repli résoluble → anomalie explicite (FR-013), jamais un montant nul :
 * un enseignant payé 0 sans explication est un bug qu'on ne détecte qu'au
 * moment de la réclamation.
 */

const RATE_COLS = `
  r.id, r.tenant_id, r.ecue_id, r.enseignant_id,
  r.montant_horaire::float8 AS montant_horaire,
  r.devise,
  r.valide_du::text AS valide_du,
  r.valide_au::text AS valide_au,
  r.notes, r.created_by, r.created_at, r.updated_at`;

const RATE_JOINS = `
  FROM professional_ecue_hourly_rates r
  JOIN professional_ecue ec ON ec.id = r.ecue_id AND ec.tenant_id = r.tenant_id
  LEFT JOIN teachers t ON t.id = r.enseignant_id
  LEFT JOIN users    u ON u.id = t.user_id`;

const RATE_LABELS = `
  ec.code    AS ecue_code,
  ec.libelle AS ecue_libelle,
  COALESCE(TRIM(u.first_name || ' ' || u.last_name),
           TRIM(t.first_name || ' ' || t.last_name)) AS enseignant_nom`;

/** Code Postgres d'une violation de contrainte d'exclusion. */
const PG_EXCLUSION_VIOLATION = "23P01";

export interface ResolvedRate extends EcueRateResolution {}

export class ProfessionalEcueRatesService extends ProfessionalBaseService {
  async list(
    tenantId: string,
    query: Partial<ProfessionalEcueHourlyRateQuery>
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["r.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;

      if (query.ecueId) {
        where.push(`r.ecue_id = $${i++}`);
        params.push(query.ecueId);
      }
      if (query.enseignantId) {
        where.push(`r.enseignant_id = $${i++}`);
        params.push(query.enseignantId);
      }
      if (query.activeOn) {
        where.push(`r.valide_du <= $${i}::date AND (r.valide_au IS NULL OR r.valide_au >= $${i}::date)`);
        params.push(query.activeOn);
        i++;
      }

      const res = await client.query(
        `SELECT ${RATE_COLS}, ${RATE_LABELS} ${RATE_JOINS}
         WHERE ${where.join(" AND ")}
         ORDER BY ec.code, (r.enseignant_id IS NULL), r.valide_du DESC`,
        params
      );
      return ok(res.rows);
    });
  }

  async getById(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${RATE_COLS}, ${RATE_LABELS} ${RATE_JOINS}
         WHERE r.id = $1 AND r.tenant_id = $2`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("RATE_NOT_FOUND", "Tarif introuvable.");
      return ok(res.rows[0]);
    });
  }

  async create(
    tenantId: string,
    input: CreateProfessionalEcueHourlyRate,
    userId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (input.valide_au && input.valide_au < input.valide_du) {
        return fail("INVALID_RANGE", "La date de fin précède la date de début.");
      }
      const ecue = await client.query(
        `SELECT 1 FROM professional_ecue WHERE id = $1 AND tenant_id = $2`,
        [input.ecue_id, tenantId]
      );
      if (ecue.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");

      try {
        const res = await client.query(
          `INSERT INTO professional_ecue_hourly_rates
             (tenant_id, ecue_id, enseignant_id, montant_horaire, devise,
              valide_du, valide_au, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)
           RETURNING ${RATE_COLS.replace(/r\./g, "")}`,
          [
            tenantId,
            input.ecue_id,
            input.enseignant_id ?? null,
            input.montant_horaire,
            input.devise ?? "XOF",
            input.valide_du,
            input.valide_au ?? null,
            input.notes ?? null,
            userId ?? null,
          ]
        );
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === PG_EXCLUSION_VIOLATION) {
          return fail(
            "RATE_OVERLAP",
            "Un tarif existe déjà pour cette ECUE et cet enseignant sur une période qui se chevauche."
          );
        }
        throw e;
      }
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateProfessionalEcueHourlyRate
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: Array<keyof UpdateProfessionalEcueHourlyRate> = [
        "ecue_id",
        "enseignant_id",
        "montant_horaire",
        "devise",
        "valide_du",
        "valide_au",
        "notes",
      ];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key] ?? null);
        }
      }
      if (sets.length === 0) return this.getById(tenantId, id);

      sets.push("updated_at = now()");
      params.push(id, tenantId);

      try {
        const res = await client.query(
          `UPDATE professional_ecue_hourly_rates r SET ${sets.join(", ")}
           WHERE r.id = $${i++} AND r.tenant_id = $${i++}
           RETURNING ${RATE_COLS}`,
          params
        );
        if (res.rowCount === 0) return fail("RATE_NOT_FOUND", "Tarif introuvable.");
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === PG_EXCLUSION_VIOLATION) {
          return fail(
            "RATE_OVERLAP",
            "La période modifiée chevauche un autre tarif pour la même ECUE et le même enseignant."
          );
        }
        if (e?.code === "23514") {
          return fail("INVALID_RANGE", "Période de validité invalide.");
        }
        throw e;
      }
    });
  }

  async remove(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM professional_ecue_hourly_rates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("RATE_NOT_FOUND", "Tarif introuvable.");
      // Les paiements déjà calculés conservent leur tarif : il est figé dans
      // payment_hour_details.hourly_rate, pas relu ici (FR-023).
      return ok({ id });
    });
  }

  /** Résolution unitaire — sert l'outil « simuler la résolution » de l'écran. */
  async resolve(
    tenantId: string,
    ecueId: string,
    enseignantId: string,
    date: string
  ): Promise<ServiceResult<EcueRateResolution>> {
    return this.withTenant(tenantId, async (client) => {
      const resolved = await resolveRateOnClient(client, tenantId, ecueId, enseignantId, date);
      if (!resolved) {
        return fail(
          "NO_RATE_RESOLVED",
          "Aucun tarif ECUE ni tarif horaire par défaut applicable pour cet enseignant à cette date."
        );
      }
      return ok(resolved);
    });
  }

  /**
   * Précharge tous les tarifs ECUE valides sur une période, pour éviter un
   * aller-retour SQL par séance lors d'un calcul de paie (SC-006).
   */
  async preloadForPeriod(
    tenantId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<EcueRateIndex> {
    return this.withTenant(tenantId, async (client) =>
      preloadRatesOnClient(client, tenantId, periodStart, periodEnd)
    );
  }
}

/* ===================================================================== */
/* Résolution — fonctions libres, réutilisables par le calculateur        */
/* ===================================================================== */

interface RateRow {
  id: string;
  ecue_id: string;
  enseignant_id: string | null;
  montant_horaire: number;
  devise: string;
  valide_du: string;
  valide_au: string | null;
}

/**
 * Index des tarifs d'une période, interrogeable sans SQL.
 * Clé : `${ecueId}|${enseignantId ?? '*'}`, valeur triée par `valide_du` DESC.
 */
export class EcueRateIndex {
  private readonly byKey = new Map<string, RateRow[]>();

  constructor(rows: RateRow[]) {
    for (const row of rows) {
      const key = `${row.ecue_id}|${row.enseignant_id ?? "*"}`;
      const list = this.byKey.get(key);
      if (list) list.push(row);
      else this.byKey.set(key, [row]);
    }
    for (const list of this.byKey.values()) {
      list.sort((a, b) => (a.valide_du < b.valide_du ? 1 : a.valide_du > b.valide_du ? -1 : 0));
    }
  }

  /**
   * Tarif applicable à une date, nominatif d'abord. Ne consulte PAS le tarif
   * par défaut de l'enseignant : c'est au calculateur de faire ce dernier repli,
   * puisqu'il détient déjà la configuration de paie.
   */
  find(ecueId: string, enseignantId: string, date: string): ResolvedRate | null {
    for (const [key, origine] of [
      [`${ecueId}|${enseignantId}`, "ecue_enseignant"],
      [`${ecueId}|*`, "ecue_generique"],
    ] as const) {
      const candidates = this.byKey.get(key);
      if (!candidates) continue;
      const hit = candidates.find(
        (r) => r.valide_du <= date && (r.valide_au === null || r.valide_au >= date)
      );
      if (hit) {
        return {
          montant_horaire: Number(hit.montant_horaire),
          devise: hit.devise,
          origine,
          rate_id: hit.id,
        };
      }
    }
    return null;
  }
}

export async function preloadRatesOnClient(
  client: PoolClient,
  tenantId: string,
  periodStart: string,
  periodEnd: string
): Promise<EcueRateIndex> {
  const res = await client.query(
    `SELECT id, ecue_id, enseignant_id,
            montant_horaire::float8 AS montant_horaire, devise,
            valide_du::text AS valide_du, valide_au::text AS valide_au
     FROM professional_ecue_hourly_rates
     WHERE tenant_id = $1
       AND valide_du <= $3::date
       AND (valide_au IS NULL OR valide_au >= $2::date)`,
    [tenantId, periodStart, periodEnd]
  );
  return new EcueRateIndex(res.rows as RateRow[]);
}

/** Résolution unitaire, repli sur la configuration de paie compris. */
export async function resolveRateOnClient(
  client: PoolClient,
  tenantId: string,
  ecueId: string,
  enseignantId: string,
  date: string
): Promise<ResolvedRate | null> {
  const res = await client.query(
    `SELECT id, montant_horaire::float8 AS montant_horaire, devise,
            (enseignant_id IS NULL) AS generique
     FROM professional_ecue_hourly_rates
     WHERE tenant_id = $1
       AND ecue_id   = $2
       AND (enseignant_id = $3 OR enseignant_id IS NULL)
       AND valide_du <= $4::date
       AND (valide_au IS NULL OR valide_au >= $4::date)
     ORDER BY (enseignant_id IS NULL), valide_du DESC
     LIMIT 1`,
    [tenantId, ecueId, enseignantId, date]
  );

  if ((res.rowCount ?? 0) > 0) {
    const row = res.rows[0];
    return {
      montant_horaire: Number(row.montant_horaire),
      devise: row.devise,
      origine: row.generique ? "ecue_generique" : "ecue_enseignant",
      rate_id: row.id,
    };
  }

  const cfg = await client.query(
    `SELECT default_hourly_rate::float8 AS rate
     FROM teacher_payment_configs
     WHERE tenant_id = $1 AND teacher_id = $2
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
       AND default_hourly_rate IS NOT NULL
     ORDER BY effective_from DESC
     LIMIT 1`,
    [tenantId, enseignantId, date]
  );
  if ((cfg.rowCount ?? 0) > 0 && cfg.rows[0].rate != null) {
    return {
      montant_horaire: Number(cfg.rows[0].rate),
      devise: "XOF",
      origine: "config_defaut",
      rate_id: null,
    };
  }

  return null;
}
