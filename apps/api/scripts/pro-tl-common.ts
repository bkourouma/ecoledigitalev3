/**
 * Socle commun des scripts de peuplement du parcours PROFESSIONNEL
 * MASTER 1 / MASTER 2 TRANSPORT LOGISTIQUE (M1TL / M2TL).
 *
 * Principe : les scripts n'écrivent JAMAIS de SQL métier à la main. Ils
 * instancient les services réels du module professionnel (`apps/api/src/services`)
 * avec un `Pool` local, de sorte que les données produites soient identiques,
 * ligne pour ligne, à celles qu'auraient créées les pages d'administration.
 *
 * Calendrier retenu (parcours complet, entièrement dans le passé pour que
 * bulletins / attestations / diplômes aient un sens) :
 *   M1TL  S1 2024-10-07→2024-12-20   S2 2025-01-13→2025-03-28   S3 2025-04-07→2025-06-20
 *   M2TL  S1 2025-10-06→2025-12-19   S2 2026-01-12→2026-03-27   S3 2026-04-06→2026-06-19
 */
import "dotenv/config";
import { Pool } from "pg";

export const TENANT_SLUG = "ecoledigitale";

export const FILIERES = [
  { code: "M1TL", label: "MASTER 1 TRANSPORT LOGISTIQUE" },
  { code: "M2TL", label: "MASTER 2 TRANSPORT LOGISTIQUE" },
] as const;

/** Fenêtres de chaque semestre : cours + période d'inscription. */
export const CALENDRIER: Record<string, Record<number, Periode>> = {
  M1TL: {
    1: { debut: "2024-10-07", fin: "2024-12-20", inscOuvre: "2024-09-02", inscFerme: "2024-10-06" },
    2: { debut: "2025-01-13", fin: "2025-03-28", inscOuvre: "2024-12-02", inscFerme: "2025-01-12" },
    3: { debut: "2025-04-07", fin: "2025-06-20", inscOuvre: "2025-03-03", inscFerme: "2025-04-06" },
  },
  M2TL: {
    1: { debut: "2025-10-06", fin: "2025-12-19", inscOuvre: "2025-09-01", inscFerme: "2025-10-05" },
    2: { debut: "2026-01-12", fin: "2026-03-27", inscOuvre: "2025-12-01", inscFerme: "2026-01-11" },
    3: { debut: "2026-04-06", fin: "2026-06-19", inscOuvre: "2026-03-02", inscFerme: "2026-04-05" },
  },
};

export interface Periode {
  debut: string;
  fin: string;
  inscOuvre: string;
  inscFerme: string;
}

export function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL absent (apps/api/.env)");
    process.exit(1);
  }
  return new Pool({ connectionString, max: 4 });
}

export async function getTenantId(pool: Pool): Promise<string> {
  const r = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
  if (r.rowCount === 0) throw new Error(`Tenant « ${TENANT_SLUG} » introuvable.`);
  return r.rows[0].id as string;
}

/** Id d'un utilisateur admin — sert de `created_by` / `saisi_par` / `octroye_par`. */
export async function getAdminUserId(pool: Pool, tenantId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles ro ON ro.id = ur.role_id
     WHERE u.tenant_id = $1 AND ro.key IN ('admin','super_admin')
     ORDER BY ro.key LIMIT 1`,
    [tenantId]
  );
  return r.rowCount ? (r.rows[0].id as string) : null;
}

export async function getFiliere(
  pool: Pool,
  tenantId: string,
  code: string
): Promise<{ id: string; code: string; name: string }> {
  const r = await pool.query(
    `SELECT id, code, name FROM programmes WHERE tenant_id = $1 AND code = $2`,
    [tenantId, code]
  );
  if (r.rowCount === 0) throw new Error(`Filière ${code} introuvable.`);
  return r.rows[0];
}

/** Semestres d'une filière, indexés par numéro déduit du libellé (« Semestre 2 » → 2). */
export async function getSemestres(
  pool: Pool,
  tenantId: string,
  filiereId: string
): Promise<Array<{ id: string; libelle: string; numero: number }>> {
  const r = await pool.query(
    `SELECT id, libelle FROM professional_semestres
     WHERE tenant_id = $1 AND filiere_id = $2 ORDER BY libelle`,
    [tenantId, filiereId]
  );
  return r.rows.map((x: any) => ({
    id: x.id,
    libelle: x.libelle,
    numero: Number(String(x.libelle).replace(/\D+/g, "")) || 0,
  }));
}

/** Les 20 étudiants créés pour ce parcours (matricules ED-2026-001…020). */
export async function getCohorte(
  pool: Pool,
  tenantId: string
): Promise<Array<{ id: string; nom: string; matricule: string }>> {
  const r = await pool.query(
    `SELECT sp.id, u.first_name, u.last_name, sp.student_matricule
     FROM student_profiles sp
     JOIN users u ON u.id = sp.user_id
     WHERE sp.tenant_id = $1 AND sp.student_matricule LIKE 'ED-2026-%'
     ORDER BY sp.student_matricule`,
    [tenantId]
  );
  return r.rows.map((x: any) => ({
    id: x.id,
    nom: `${x.first_name} ${x.last_name}`,
    matricule: x.student_matricule,
  }));
}

/** Sessions d'une filière avec leur semestre, UE et ECUE. */
export async function getSessions(
  pool: Pool,
  tenantId: string,
  filiereId: string
): Promise<
  Array<{
    id: string;
    libelle: string;
    statut: string;
    date_debut: string;
    date_fin: string;
    ue_id: string;
    ue_code: string;
    nb_uv: number;
    prix: number;
    semestre_id: string;
    semestre_numero: number;
  }>
> {
  const r = await pool.query(
    `SELECT s.id, s.libelle, s.statut,
            s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
            s.ue_id, ue.code AS ue_code, ue.nb_uv::int AS nb_uv, ue.prix::float8 AS prix,
            sem.id AS semestre_id, sem.libelle AS semestre_libelle
     FROM professional_ue_sessions s
     JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
     JOIN professional_semestre_sessions ss ON ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
     JOIN professional_semestres sem ON sem.id = ss.semestre_id
     WHERE s.tenant_id = $1 AND ue.filiere_id = $2
     ORDER BY sem.libelle, ue.code`,
    [tenantId, filiereId]
  );
  return r.rows.map((x: any) => ({
    ...x,
    semestre_numero: Number(String(x.semestre_libelle).replace(/\D+/g, "")) || 0,
  }));
}

/** ECUE d'une session, avec le drapeau « Conduite » (note de semestre, sans cours). */
export async function getSessionEcues(
  pool: Pool,
  tenantId: string,
  ueSessionId: string
): Promise<Array<{ id: string; code: string; libelle: string; credits: number; is_conduite: boolean }>> {
  const r = await pool.query(
    `SELECT e.id, e.code, e.libelle, COALESCE(e.credits, 0)::int AS credits,
            (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%') AS is_conduite
     FROM professional_ue_sessions s
     JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
     JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2
     ORDER BY l.ordre, e.code`,
    [ueSessionId, tenantId]
  );
  return r.rows;
}

/* --------------------------- Utilitaires --------------------------- */

/** Générateur pseudo-aléatoire déterministe (résultats reproductibles). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Toutes les dates d'un jour de semaine donné (1=lundi … 7=dimanche) dans une période. */
export function datesForWeekday(debut: string, fin: string, jour: number): string[] {
  const out: string[] = [];
  const end = new Date(`${fin}T00:00:00Z`);
  let d = new Date(`${debut}T00:00:00Z`);
  while (d <= end) {
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (dow === jour) out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

export function must<T>(r: { success: boolean; data?: T; error?: string; message?: string }, ctx: string): T {
  if (!r.success) throw new Error(`${ctx} → ${r.error}: ${r.message}`);
  return r.data as T;
}

export function log(msg: string) {
  console.log(msg);
}
