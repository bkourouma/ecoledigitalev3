/**
 * Aides communes des cas d'usage : normalisation d'une identité saisie, détection de doublons, paramètres du tenant.
 */
import { ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { PeopleDuplicateCandidateDto, PeoplePersonInput, PeoplePersonPatch } from "@ecoledigitale/contracts/src/v2/people";
import { PeopleErrors } from "../domain/errors";
import { compareMatches, matchPerson, type DuplicateOptions, type DuplicateSubject } from "../domain/duplicates";
import { cleanText, displayName, isPlausibleBirthDate, normalizeEmail, normalizePhone } from "../domain/normalize";
import { DEFAULT_SETTINGS } from "../domain/reference-data";
import { findDuplicateCandidates, type NewPerson, type PersonPatchValues } from "../infrastructure/persons-repo";
import { ensureTenantDefaults, getSettings, type SettingsRow } from "../infrastructure/reference-repo";
import { todayOf, type PeopleDeps } from "./deps";

/** Rôles qu'un acteur a le droit de VOIR sur une personne candidate (cloisonnement : un RH ne doit pas apprendre qu'une personne est tutrice). */
export interface RoleVisibility {
  student: boolean;
  guardian: boolean;
  staff: boolean;
}
export const SEE_NO_ROLE: RoleVisibility = { student: false, guardian: false, staff: false };

export async function defaultCountryOf(deps: PeopleDeps, ctx: RequestContext): Promise<string | null> {
  return deps.country ? deps.country.defaultCountry(ctx) : null;
}

/** Paramètres du tenant ; les crée (avec les référentiels) au premier usage SAUF en lecture seule (valeurs par défaut en mémoire). */
export async function loadSettings(deps: PeopleDeps, tx: Tx, ctx: RequestContext, options: { write: boolean }): Promise<SettingsRow> {
  if (options.write) return ensureTenantDefaults(tx, ctx.tenantId, deps.newId, deps.clock.now());
  const existing = await getSettings(tx, ctx.tenantId);
  return (
    existing ?? {
      studentNumberPattern: DEFAULT_SETTINGS.studentNumberPattern,
      staffNumberPattern: DEFAULT_SETTINGS.staffNumberPattern,
      numberPrefix: null,
      duplicateCheckEnabled: DEFAULT_SETTINGS.duplicateCheckEnabled,
      expiryAlertDays: DEFAULT_SETTINGS.expiryAlertDays,
      studentRetentionDays: null,
    }
  );
}

const blankToUndefined = (v: string | null | undefined): string | null | undefined => (v === undefined || v === null ? v : cleanText(v) || null);

/**
 * Normalise une identité saisie : espaces, e-mail en minuscules, téléphones en E.164 quand le pays est connu, date de
 * naissance vraisemblable (calendaire, pas dans le futur — AUCUN seuil d'âge). Renvoie les valeurs prêtes à écrire.
 */
export async function normalizePersonInput<T extends PeoplePersonInput | PeoplePersonPatch>(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: T,
  pathPrefix: ReadonlyArray<string | number> = ["person"],
): Promise<Result<PersonPatchValues, AppError>> {
  const country = await defaultCountryOf(deps, ctx);
  const today = todayOf(deps);
  const out: PersonPatchValues = {};
  const i = input as Record<string, string | null | undefined>;
  if (i.lastName !== undefined) out.lastName = cleanText(i.lastName ?? "");
  if (i.firstName !== undefined) out.firstName = cleanText(i.firstName ?? "");
  if (out.lastName === "" || out.firstName === "") {
    return err(ValidationError.field([...pathPrefix, out.lastName === "" ? "lastName" : "firstName"], "Le nom et le prénom sont obligatoires.", "required"));
  }
  if (i.otherNames !== undefined) out.otherNames = blankToUndefined(i.otherNames) ?? null;
  if (i.sex !== undefined) out.sex = i.sex as "M" | "F" | null;
  if (i.birthDate !== undefined) {
    if (i.birthDate !== null && !isPlausibleBirthDate(i.birthDate, today)) return err(PeopleErrors.birthDateImplausible([...pathPrefix, "birthDate"]));
    out.birthDate = i.birthDate;
  }
  if (i.birthPlace !== undefined) out.birthPlace = blankToUndefined(i.birthPlace) ?? null;
  if (i.nationality !== undefined) out.nationality = i.nationality;
  if (i.email !== undefined) out.email = i.email === null ? null : normalizeEmail(i.email);
  if (i.phone !== undefined) out.phone = i.phone === null ? null : normalizePhone(i.phone, country);
  if (i.phoneAlt !== undefined) out.phoneAlt = i.phoneAlt === null ? null : normalizePhone(i.phoneAlt, country);
  if (i.addressLine !== undefined) out.addressLine = blankToUndefined(i.addressLine) ?? null;
  if (i.city !== undefined) out.city = blankToUndefined(i.city) ?? null;
  if (i.residence !== undefined) out.residence = blankToUndefined(i.residence) ?? null;
  for (const key of ["phone", "phoneAlt"] as const) {
    if (i[key] && out[key] === null) return err(ValidationError.field([...pathPrefix, key], "Numéro de téléphone invalide.", "invalid_phone"));
  }
  return ok(out);
}

export function toNewPerson(id: string, v: PersonPatchValues, extra: { externalRef?: string | undefined; attributes?: Record<string, unknown> | undefined } = {}): NewPerson {
  return {
    id,
    lastName: v.lastName as string,
    firstName: v.firstName as string,
    otherNames: v.otherNames,
    sex: v.sex,
    birthDate: v.birthDate,
    birthPlace: v.birthPlace,
    nationality: v.nationality,
    email: v.email,
    phone: v.phone,
    phoneAlt: v.phoneAlt,
    addressLine: v.addressLine,
    city: v.city,
    residence: v.residence,
    externalRef: extra.externalRef,
    attributes: extra.attributes,
  };
}

/** Noms des champs d'identité réellement renseignés dans un patch (pour l'audit et les événements : jamais les valeurs). */
export function changedPersonFields(patch: PersonPatchValues): string[] {
  return Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}

/**
 * Détecte les doublons possibles d'une identité. `roles` des candidats est filtré par `visibility`. Les candidats sont
 * triés du plus fort au plus faible.
 */
export async function detectDuplicates(
  tx: Tx,
  ctx: RequestContext,
  draft: DuplicateSubject,
  visibility: RoleVisibility,
  options: DuplicateOptions = {},
  excludePersonId?: string,
): Promise<PeopleDuplicateCandidateDto[]> {
  const rows = await findDuplicateCandidates(tx, ctx.tenantId, { lastName: draft.lastName, firstName: draft.firstName, email: draft.email, phone: draft.phone });
  const found: Array<{ dto: PeopleDuplicateCandidateDto; rank: ReturnType<typeof matchPerson> & string }> = [];
  for (const r of rows) {
    if (r.personId === excludePersonId) continue;
    const match = matchPerson(draft, { lastName: r.lastName, firstName: r.firstName, otherNames: r.otherNames, birthDate: r.birthDate, email: r.email, phone: r.phone }, options);
    if (!match) continue;
    const roles: PeopleDuplicateCandidateDto["roles"] = [];
    if (r.studentId && visibility.student) roles.push("STUDENT");
    if (r.isGuardian && visibility.guardian) roles.push("GUARDIAN");
    if (r.isStaff && visibility.staff) roles.push("STAFF");
    found.push({
      rank: match,
      dto: {
        personId: r.personId,
        displayName: displayName(r.lastName, r.firstName),
        birthDate: r.birthDate,
        match,
        roles,
        studentId: visibility.student ? r.studentId : null,
        studentNumber: visibility.student ? r.studentNumber : null,
      },
    });
  }
  found.sort((a, b) => compareMatches(a.rank, b.rank) || a.dto.displayName.localeCompare(b.dto.displayName));
  return found.slice(0, 20).map((f) => f.dto);
}

/** Verrou consultatif de transaction sur une clé d'idempotence (deux créations simultanées avec la même référence externe). */
export async function lockKey(tx: Tx, ctx: RequestContext, scope: string, key: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`people:${scope}:${ctx.tenantId}:${key}`]);
}
