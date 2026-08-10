import type { PoolClient } from "pg";

/**
 * Regroupement des filières en « cycles » (Licence 1→3, Master 1→2) — le
 * diplôme couvre l'intégralité du cycle, pas une seule année. Une filière
 * s'appelle par convention « LICENCE <n> <spécialité> » ou « MASTER <n>
 * <spécialité> » ; deux filières partagent un cycle si elles ont le même
 * grade et la même spécialité (comparaison insensible à la casse/aux
 * espaces). Pas de table dédiée : dérivé du libellé à la volée.
 */

export interface CycleGroupFiliere {
  id: string;
  name: string;
  code: string;
  niveau: number;
}

export interface CycleGroup {
  /** Filière terminale (plus haut niveau) — identifiant du groupe dans l'API. */
  id: string;
  grade: "LICENCE" | "MASTER";
  specialite: string;
  libelle: string;
  filieres: CycleGroupFiliere[];
}

const GRADE_RE = /^\s*(LICENCE|MASTER)\s+(\d+)\s+(.+?)\s*$/i;

function toTitleCase(s: string): string {
  return s
    .toLocaleLowerCase("fr-FR")
    .split(/(\s|-)/)
    .map((part) =>
      part.trim() === "" || part === "-" ? part : part.charAt(0).toLocaleUpperCase("fr-FR") + part.slice(1)
    )
    .join("");
}

/** Regroupe une liste plate de filières (id/name/code) en cycles. Fonction pure, testable. */
export function buildCycleGroups(
  filieres: Array<{ id: string; name: string; code: string }>
): CycleGroup[] {
  const groups = new Map<string, CycleGroupFiliere[] & { grade: "LICENCE" | "MASTER"; specialite: string }>();
  for (const f of filieres) {
    const m = f.name.match(GRADE_RE);
    if (!m) continue;
    const grade = m[1].toUpperCase() as "LICENCE" | "MASTER";
    const specialite = m[3].trim().toUpperCase();
    const key = `${grade}::${specialite}`;
    let arr = groups.get(key) as any;
    if (!arr) {
      arr = Object.assign([], { grade, specialite });
      groups.set(key, arr);
    }
    arr.push({ id: f.id, name: f.name, code: f.code, niveau: Number(m[2]) });
  }

  const result: CycleGroup[] = [];
  for (const arr of groups.values()) {
    const filieresSorted = [...arr].sort((a, b) => a.niveau - b.niveau);
    const terminal = filieresSorted[filieresSorted.length - 1];
    const specialiteLabel = toTitleCase((arr as any).specialite);
    const gradeLabel = (arr as any).grade === "LICENCE" ? "Licence" : "Master";
    result.push({
      id: terminal.id,
      grade: (arr as any).grade,
      specialite: (arr as any).specialite,
      libelle: `${gradeLabel} — ${specialiteLabel}`,
      filieres: filieresSorted,
    });
  }
  result.sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  return result;
}

/** Charge toutes les filières ayant au moins un étudiant inscrit (même critère que la page Notes), puis les groupe en cycles. */
export async function loadCycleGroups(client: PoolClient, tenantId: string): Promise<CycleGroup[]> {
  const res = await client.query(
    `SELECT DISTINCT p.id, p.name, p.code
     FROM programmes p
     JOIN professional_ue u ON u.filiere_id = p.id AND u.tenant_id = p.tenant_id
     JOIN professional_ue_sessions s ON s.ue_id = u.id AND s.tenant_id = u.tenant_id
     WHERE p.tenant_id = $1
       AND EXISTS (
         SELECT 1 FROM professional_enrollments en
         WHERE en.ue_session_id = s.id AND en.tenant_id = s.tenant_id
           AND en.statut IN ('confirmee','terminee')
       )
     ORDER BY p.name`,
    [tenantId]
  );
  return buildCycleGroups(res.rows as Array<{ id: string; name: string; code: string }>);
}

/** Résout le groupe de cycle (toutes les années) contenant `filiereId`, quel que soit son niveau. */
export async function resolveCycleGroupFor(
  client: PoolClient,
  tenantId: string,
  filiereId: string
): Promise<CycleGroup | null> {
  const selfRes = await client.query(`SELECT id, name, code FROM programmes WHERE id=$1 AND tenant_id=$2`, [
    filiereId,
    tenantId,
  ]);
  if (selfRes.rowCount === 0) return null;
  const self = selfRes.rows[0] as { id: string; name: string; code: string };
  const m = self.name.match(GRADE_RE);
  if (!m) {
    return {
      id: self.id,
      grade: "LICENCE",
      specialite: self.name,
      libelle: self.name,
      filieres: [{ id: self.id, name: self.name, code: self.code, niveau: 1 }],
    };
  }
  const grade = m[1].toUpperCase();
  const specialite = m[3].trim();
  const siblingsRes = await client.query(
    `SELECT id, name, code FROM programmes
     WHERE tenant_id=$1 AND name ~* $2`,
    [tenantId, `^\\s*${grade}\\s+\\d+\\s+${specialite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`]
  );
  const groups = buildCycleGroups(siblingsRes.rows as Array<{ id: string; name: string; code: string }>);
  return groups.find((g) => g.filieres.some((f) => f.id === filiereId)) ?? groups[0] ?? null;
}

export interface RequiredUe {
  ue_id: string;
  code: string;
  libelle: string;
  nb_uv: number;
  filiere_id: string;
  filiere_niveau: number;
}

/** UE exigées par un cycle (union des UE rattachées aux semestres de chacune de ses filières). */
export async function loadRequiredUeForCycle(
  client: PoolClient,
  tenantId: string,
  group: CycleGroup
): Promise<RequiredUe[]> {
  const filiereIds = group.filieres.map((f) => f.id);
  const res = await client.query(
    `SELECT DISTINCT u.id AS ue_id, u.code, u.libelle, u.nb_uv, u.filiere_id
     FROM professional_semestre_ue su
     JOIN professional_semestres sm ON sm.id = su.semestre_id AND sm.tenant_id = su.tenant_id
     JOIN professional_ue u ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
     WHERE sm.tenant_id = $1 AND sm.filiere_id = ANY($2::uuid[])
     ORDER BY u.code ASC`,
    [tenantId, filiereIds]
  );
  const niveauByFiliere = new Map(group.filieres.map((f) => [f.id, f.niveau]));
  return (res.rows as Array<{ ue_id: string; code: string; libelle: string; nb_uv: number; filiere_id: string }>).map(
    (r) => ({ ...r, filiere_niveau: niveauByFiliere.get(r.filiere_id) ?? 0 })
  );
}

/**
 * UE validées par l'étudiant parmi `ueIds`. Les UE « Conduite » ne transitent
 * jamais par `student_professional_ue_results` (l'ECUE Conduite est
 * explicitement exclue du calcul de moyenne d'UE ailleurs dans l'appli — voir
 * `NOT_CONDUITE` dans `professional-results.service.ts` et le bloc dédié de
 * `professional-bulletin.service.ts`) : leur validation s'y lit en direct sur
 * la note d'examen de l'ECUE Conduite (≥ 10), exactement comme la page
 * Bulletins.
 */
export async function loadValidatedUeIdsWithConduite(
  client: PoolClient,
  tenantId: string,
  studentId: string,
  ueIds: string[]
): Promise<Set<string>> {
  if (ueIds.length === 0) return new Set();
  const res = await client.query(
    `SELECT ue_id FROM student_professional_ue_results
     WHERE tenant_id=$1 AND student_id=$2 AND statut='validee' AND ue_id = ANY($3::uuid[])`,
    [tenantId, studentId, ueIds]
  );
  const validated = new Set(res.rows.map((r: any) => r.ue_id as string));

  const conduiteRes = await client.query(
    `SELECT DISTINCT u.id AS ue_id
     FROM professional_ue u
     JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
     JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = u.tenant_id
     JOIN professional_ecue_notes n ON n.ecue_id = e.id
       AND n.student_id = $2 AND n.tenant_id = $1 AND n.nature = 'examen'
     WHERE u.id = ANY($3::uuid[]) AND u.tenant_id = $1
       AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
       AND n.note >= 10`,
    [tenantId, studentId, ueIds]
  );
  for (const row of conduiteRes.rows as Array<{ ue_id: string }>) {
    validated.add(row.ue_id);
  }
  return validated;
}

/**
 * Toutes les UE validées par l'étudiant, tous cycles/filières confondus
 * (Conduite incluse — voir `loadValidatedUeIdsWithConduite`). Utilisé par
 * l'éligibilité aux diplômes, qui intersecte ensuite avec les UE exigées.
 */
export async function loadAllValidatedUeIdsWithConduite(
  client: PoolClient,
  tenantId: string,
  studentId: string
): Promise<string[]> {
  const res = await client.query(
    `SELECT ue_id FROM student_professional_ue_results
     WHERE student_id=$1 AND tenant_id=$2 AND statut='validee'`,
    [studentId, tenantId]
  );
  const validated = new Set(res.rows.map((r: any) => r.ue_id as string));

  const conduiteRes = await client.query(
    `SELECT DISTINCT u.id AS ue_id
     FROM professional_ue u
     JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
     JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = u.tenant_id
     JOIN professional_ecue_notes n ON n.ecue_id = e.id
       AND n.student_id = $2 AND n.tenant_id = $1 AND n.nature = 'examen'
     WHERE u.tenant_id = $1
       AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
       AND n.note >= 10`,
    [tenantId, studentId]
  );
  for (const row of conduiteRes.rows as Array<{ ue_id: string }>) {
    validated.add(row.ue_id);
  }
  return [...validated];
}

/**
 * Mention dérivée des bulletins de l'étudiant sur les semestres d'un ensemble
 * de filières (une seule pour une attestation de filière, toutes celles d'un
 * cycle pour un diplôme Licence/Master) : moyenne pondérée par les crédits de
 * chaque semestre, puis les mêmes seuils d'appréciation que la page Bulletins
 * (`appreciation()` dans `apps/web/src/lib/bulletin-format.ts`).
 */
export async function loadMentionForFilieres(
  client: PoolClient,
  tenantId: string,
  filiereIds: string[],
  studentId: string
): Promise<string | null> {
  if (filiereIds.length === 0) return null;
  const res = await client.query(
    `SELECT (b.data->>'moyenne_session')::float8 AS moyenne_session,
            (b.data->>'credits_total')::int AS credits_total
     FROM professional_bulletins b
     JOIN professional_semestres sm ON sm.id = b.semestre_id AND sm.tenant_id = b.tenant_id
     WHERE sm.tenant_id = $1 AND sm.filiere_id = ANY($2::uuid[]) AND b.student_id = $3`,
    [tenantId, filiereIds, studentId]
  );
  let somme = 0;
  let credits = 0;
  for (const row of res.rows as Array<{ moyenne_session: number | null; credits_total: number | null }>) {
    if (row.moyenne_session == null) continue;
    const c = row.credits_total && row.credits_total > 0 ? row.credits_total : 0;
    somme += row.moyenne_session * c;
    credits += c;
  }
  if (credits === 0) return null;
  const moyenne = somme / credits;
  if (moyenne < 10) return "Insuffisant";
  if (moyenne < 12) return "Passable";
  if (moyenne < 14) return "Assez Bien";
  if (moyenne < 16) return "Bien";
  if (moyenne < 18) return "Très Bien";
  return "Excellent";
}
