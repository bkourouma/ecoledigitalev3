/**
 * Résolution de noms PAR LOTS (une requête SQL, jamais N) pour les écrans qui affichent des listes d'identifiants
 * (finance, présences, résultats, paie…) : `lookupStudents`, `lookupStaff`, et leurs variantes « Map de noms »
 * `getDisplayNamesOfStudents` / `getDisplayNamesOfStaff` pour les modules et adaptateurs.
 *
 * Garanties :
 *  - réponse MINIMALE : identifiant, « NOM Prénom », matricule, statut. Jamais de naissance, contact, photo, inscription,
 *    identifiant national, compte lié ni contrat ;
 *  - ids dédoublonnés (l'ordre de première apparition est conservé), plafond {@link LOOKUP_MAX_IDS} distincts par appel
 *    (`people.too_many` au-delà) — l'API HTTP est plus stricte (`PEOPLE_LOOKUP_MAX_IDS`, longueur d'URL) ;
 *  - `missing` = identifiants demandés et non restitués : inconnus, d'un autre tenant (la RLS les rend invisibles) OU
 *    hors du périmètre de l'appelant — INDISCERNABLES (aucune fuite d'existence) ;
 *  - périmètre : `scope` (`ALL` ou `IDS`) calculé par les gardes d'accès existantes (`access.ts`) ; les identifiants hors
 *    périmètre ne sont même pas lus en base ;
 *  - jamais d'écriture ; une transaction en lecture seule.
 */
import { ValidationError, err, isUuid, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PeopleStaffLookupItem, PeopleStudentLookupItem } from "@ecoledigitale/contracts/src/v2/people";
import { displayName } from "../domain/normalize";
import * as staffRepo from "../infrastructure/staff-repo";
import * as studentsRepo from "../infrastructure/students-repo";
import { inTx, type PeopleDeps } from "./deps";

/** Plafond de l'API publique (aligné sur `getStudentsByIds` / `getStaffByIds`). */
export const LOOKUP_MAX_IDS = 500;

export type LookupScope = { kind: "ALL" } | { kind: "IDS"; ids: readonly string[] };

export interface LookupResult<T> {
  /** Dans l'ordre des identifiants demandés (dédoublonnés). */
  items: T[];
  /** Demandés, non restitués : inconnus, autre tenant ou hors périmètre (indiscernables). */
  missing: string[];
}

export interface LookupOptions {
  /** Périmètre de l'appelant ; absent = `ALL` (l'appelant a déjà autorisé sa propre route). */
  scope?: LookupScope | undefined;
}

/** Identifiants distincts, ordre de première apparition. */
export function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function validate(deps: PeopleDeps, ids: readonly string[]): Result<string[], AppError> {
  const unique = dedupeIds(ids);
  const max = Math.min(LOOKUP_MAX_IDS, deps.config.maxBatchSize);
  if (unique.length > max) return err(ValidationError.field("ids", `Au plus ${max} identifiants distincts par appel.`, "too_many"));
  const bad = unique.find((id) => !isUuid(id));
  if (bad !== undefined) return err(ValidationError.field("ids", "Identifiant invalide (UUID attendu).", "invalid_uuid"));
  return ok(unique);
}

function allowedIds(unique: readonly string[], scope: LookupScope | undefined): string[] {
  if (!scope || scope.kind === "ALL") return [...unique];
  const inScope = new Set(scope.ids);
  return unique.filter((id) => inScope.has(id));
}

function assemble<T extends { id: string }>(unique: readonly string[], found: readonly T[]): LookupResult<T> {
  const byId = new Map(found.map((f) => [f.id, f]));
  const items: T[] = [];
  const missing: string[] = [];
  for (const id of unique) {
    const hit = byId.get(id);
    if (hit) items.push(hit);
    else missing.push(id);
  }
  return { items, missing };
}

export async function lookupStudents(deps: PeopleDeps, ctx: RequestContext, ids: readonly string[], options: LookupOptions = {}): Promise<Result<LookupResult<PeopleStudentLookupItem>, AppError>> {
  const unique = validate(deps, ids);
  if (!unique.ok) return unique;
  const wanted = allowedIds(unique.value, options.scope);
  const found = await inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        (await studentsRepo.getStudentRows(tx, ctx.tenantId, wanted)).map(
          (r): PeopleStudentLookupItem => ({ id: r.studentId, displayName: displayName(r.lastName, r.firstName), studentNumber: r.studentNumber, status: r.status }),
        ),
      ),
    { readOnly: true },
  );
  if (!found.ok) return found;
  return ok(assemble(unique.value, found.value));
}

export async function lookupStaff(deps: PeopleDeps, ctx: RequestContext, ids: readonly string[], options: LookupOptions = {}): Promise<Result<LookupResult<PeopleStaffLookupItem>, AppError>> {
  const unique = validate(deps, ids);
  if (!unique.ok) return unique;
  const wanted = allowedIds(unique.value, options.scope);
  const found = await inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        (await staffRepo.getStaffRows(tx, ctx.tenantId, wanted)).map(
          (r): PeopleStaffLookupItem => ({ id: r.staffId, displayName: displayName(r.lastName, r.firstName), staffNumber: r.staffNumber, status: r.status }),
        ),
      ),
    { readOnly: true },
  );
  if (!found.ok) return found;
  return ok(assemble(unique.value, found.value));
}

/** Découpe en lots du plafond (les modules appelants n'ont pas à connaître la limite). */
function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function namesOf<T extends { id: string; displayName: string }>(
  deps: PeopleDeps,
  ids: readonly string[],
  read: (batch: string[]) => Promise<Result<LookupResult<T>, AppError>>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // identifiants mal formés ignorés (un UUID invalide ferait échouer la requête entière)
  const valid = dedupeIds(ids).filter((id) => isUuid(id));
  for (const batch of chunks(valid, Math.min(LOOKUP_MAX_IDS, deps.config.maxBatchSize))) {
    const res = await read(batch);
    if (!res.ok) throw res.error;
    for (const item of res.value.items) out.set(item.id, item.displayName);
  }
  return out;
}

/**
 * « NOM Prénom » des élèves du tenant (par `studentId`), pour les adaptateurs d'autres modules. Identifiants inconnus
 * ou invalides absents du résultat. AUCUN contrôle de périmètre : l'appelant a déjà autorisé SA route ; passez par
 * `lookupStudents(…, { scope })` pour restreindre.
 */
export function getDisplayNamesOfStudents(deps: PeopleDeps, ctx: RequestContext, ids: readonly string[]): Promise<Map<string, string>> {
  return namesOf(deps, ids, (batch) => lookupStudents(deps, ctx, batch));
}

/** « NOM Prénom » des membres du personnel (par `staffId`) ; mêmes règles que {@link getDisplayNamesOfStudents}. */
export function getDisplayNamesOfStaff(deps: PeopleDeps, ctx: RequestContext, ids: readonly string[]): Promise<Map<string, string>> {
  return namesOf(deps, ids, (batch) => lookupStaff(deps, ctx, batch));
}
