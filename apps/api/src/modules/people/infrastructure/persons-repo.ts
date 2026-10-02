/**
 * `people.persons` : l'état civil commun à un élève, un tuteur, un membre du personnel. Table de TENANT (RLS forcée) ;
 * à appeler dans une transaction `TenantDb`. Jamais de DELETE (déclencheur `forbid_mutation`).
 */
import type { Tx } from "@ecoledigitale/database";
import { searchKey } from "../domain/normalize";
import { updateById } from "./sql";

export interface PersonRow {
  personId: string;
  identityId: string | null;
  lastName: string;
  firstName: string;
  otherNames: string | null;
  sex: "M" | "F" | null;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
  phoneAlt: string | null;
  addressLine: string | null;
  city: string | null;
  residence: string | null;
  photoObjectKey: string | null;
  personStatus: "ACTIVE" | "ARCHIVED";
  anonymizedAt: Date | null;
}

/** Colonnes `persons` sous l'alias `p`, nommées comme `PersonRow`. */
export const PERSON_COLUMNS = `
  p.id AS "personId", p.identity_id AS "identityId", p.last_name AS "lastName", p.first_name AS "firstName",
  p.other_names AS "otherNames", p.sex, p.birth_date::text AS "birthDate", p.birth_place AS "birthPlace",
  p.nationality, p.email, p.phone, p.phone_alt AS "phoneAlt", p.address_line AS "addressLine", p.city, p.residence,
  p.photo_object_key AS "photoObjectKey", p.status AS "personStatus", p.anonymized_at AS "anonymizedAt"`;

export interface NewPerson {
  id: string;
  lastName: string;
  firstName: string;
  otherNames?: string | null | undefined;
  sex?: "M" | "F" | null | undefined;
  birthDate?: string | null | undefined;
  birthPlace?: string | null | undefined;
  nationality?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  phoneAlt?: string | null | undefined;
  addressLine?: string | null | undefined;
  city?: string | null | undefined;
  residence?: string | null | undefined;
  externalRef?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
}

export async function insertPerson(tx: Tx, tenantId: string, p: NewPerson, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO people.persons
       (id, tenant_id, last_name, first_name, other_names, sex, birth_date, birth_place, nationality, email, phone, phone_alt,
        address_line, city, residence, external_ref, attributes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$18)`,
    [
      p.id,
      tenantId,
      p.lastName,
      p.firstName,
      p.otherNames ?? null,
      p.sex ?? null,
      p.birthDate ?? null,
      p.birthPlace ?? null,
      p.nationality ?? null,
      p.email ?? null,
      p.phone ?? null,
      p.phoneAlt ?? null,
      p.addressLine ?? null,
      p.city ?? null,
      p.residence ?? null,
      p.externalRef ?? null,
      JSON.stringify(p.attributes ?? {}),
      now,
    ],
  );
}

export async function getPerson(tx: Tx, tenantId: string, personId: string, options: { forUpdate?: boolean } = {}): Promise<PersonRow | null> {
  return tx.queryOne<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM people.persons p WHERE p.tenant_id = $1 AND p.id = $2${options.forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, personId],
  );
}

/** Noms (état civil) des personnes liées aux identités données : une ligne par identité liée, jamais de donnée de contact. */
export async function listNamesByIdentity(tx: Tx, tenantId: string, identityIds: readonly string[]): Promise<Array<{ identityId: string; lastName: string; firstName: string }>> {
  if (identityIds.length === 0) return [];
  return tx.many(
    `SELECT p.identity_id AS "identityId", p.last_name AS "lastName", p.first_name AS "firstName"
       FROM people.persons p WHERE p.tenant_id = $1 AND p.identity_id = ANY($2::uuid[]) AND p.anonymized_at IS NULL`,
    [tenantId, [...identityIds]],
  );
}

export async function findPersonByIdentity(tx: Tx, tenantId: string, identityId: string): Promise<PersonRow | null> {
  return tx.queryOne<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM people.persons p WHERE p.tenant_id = $1 AND p.identity_id = $2`, [tenantId, identityId]);
}

/** Champs modifiables d'une personne (camelCase) ; `undefined` = inchangé, `null` = effacer. */
export interface PersonPatchValues {
  lastName?: string | undefined;
  firstName?: string | undefined;
  otherNames?: string | null | undefined;
  sex?: "M" | "F" | null | undefined;
  birthDate?: string | null | undefined;
  birthPlace?: string | null | undefined;
  nationality?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  phoneAlt?: string | null | undefined;
  addressLine?: string | null | undefined;
  city?: string | null | undefined;
  residence?: string | null | undefined;
}

const PERSON_COLUMN_OF: Readonly<Record<keyof PersonPatchValues, string>> = {
  lastName: "last_name",
  firstName: "first_name",
  otherNames: "other_names",
  sex: "sex",
  birthDate: "birth_date",
  birthPlace: "birth_place",
  nationality: "nationality",
  email: "email",
  phone: "phone",
  phoneAlt: "phone_alt",
  addressLine: "address_line",
  city: "city",
  residence: "residence",
};

export const PERSON_PATCH_KEYS = Object.keys(PERSON_COLUMN_OF) as Array<keyof PersonPatchValues>;

export async function updatePerson(tx: Tx, tenantId: string, personId: string, patch: PersonPatchValues, now: Date): Promise<void> {
  const columns: Record<string, unknown> = {};
  for (const key of PERSON_PATCH_KEYS) {
    const value = patch[key];
    if (value !== undefined) columns[PERSON_COLUMN_OF[key]] = value;
  }
  if (Object.keys(columns).length === 0) return;
  // `birth_date` est de type date : le texte AAAA-MM-JJ (paramètre non typé) est converti par Postgres.
  await updateById(tx, "people.persons", tenantId, personId, columns, now);
}

export async function setPhotoKey(tx: Tx, tenantId: string, personId: string, key: string | null, now: Date): Promise<void> {
  await updateById(tx, "people.persons", tenantId, personId, { photo_object_key: key }, now);
}

export async function setIdentity(tx: Tx, tenantId: string, personId: string, identityId: string | null, now: Date): Promise<void> {
  await updateById(tx, "people.persons", tenantId, personId, { identity_id: identityId }, now);
}

/** Anonymisation (droit à l'effacement) : remplace l'état civil par des valeurs neutres, conserve l'identifiant. */
export async function anonymizePerson(tx: Tx, tenantId: string, personId: string, now: Date): Promise<void> {
  await tx.query(
    `UPDATE people.persons
        SET last_name = 'ANONYMISÉ', first_name = 'Dossier', other_names = NULL, sex = NULL, birth_date = NULL, birth_place = NULL,
            email = NULL, phone = NULL, phone_alt = NULL, address_line = NULL, city = NULL, residence = NULL,
            photo_object_key = NULL, identity_id = NULL, external_ref = NULL, attributes = '{}'::jsonb,
            status = 'ARCHIVED', anonymized_at = $3, updated_at = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, personId, now],
  );
}

export async function setPersonStatus(tx: Tx, tenantId: string, personId: string, status: "ACTIVE" | "ARCHIVED", now: Date): Promise<void> {
  await updateById(tx, "people.persons", tenantId, personId, { status }, now);
}

// ---------------------------------------------------------------------------
// Doublons
// ---------------------------------------------------------------------------

export interface DuplicateRow {
  personId: string;
  lastName: string;
  firstName: string;
  otherNames: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  studentId: string | null;
  studentNumber: string | null;
  isGuardian: boolean;
  isStaff: boolean;
}

export interface DuplicateProbe {
  lastName: string;
  firstName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
}

/**
 * Candidats de doublon : même clé de recherche (permutation nom/prénom admise), clé commençant par « nom prénom », nom
 * proche (trigrammes) ou même e-mail / téléphone. Le jugement fin (`matchPerson`) est fait par le domaine.
 */
export async function findDuplicateCandidates(tx: Tx, tenantId: string, probe: DuplicateProbe, limit = 100): Promise<DuplicateRow[]> {
  const direct = searchKey(probe.lastName, probe.firstName);
  const reverse = searchKey(probe.firstName, probe.lastName);
  return tx.many<DuplicateRow>(
    `SELECT p.id AS "personId", p.last_name AS "lastName", p.first_name AS "firstName", p.other_names AS "otherNames",
            p.birth_date::text AS "birthDate", p.email, p.phone,
            s.id AS "studentId", s.student_number AS "studentNumber",
            (g.id IS NOT NULL) AS "isGuardian", (st.id IS NOT NULL) AS "isStaff"
       FROM people.persons p
       LEFT JOIN people.students s  ON s.tenant_id = p.tenant_id AND s.person_id = p.id
       LEFT JOIN people.guardians g ON g.tenant_id = p.tenant_id AND g.person_id = p.id
       LEFT JOIN people.staff st    ON st.tenant_id = p.tenant_id AND st.person_id = p.id
      WHERE p.tenant_id = $1
        AND p.anonymized_at IS NULL
        AND ( p.search_key = ANY($2::text[])
              OR p.search_key LIKE ANY($3::text[])
              OR p.search_key % $4
              OR ($5::text IS NOT NULL AND lower(p.email) = $5)
              OR ($6::text IS NOT NULL AND p.phone = $6) )
      ORDER BY similarity(p.search_key, $4) DESC, p.id
      LIMIT $7`,
    [tenantId, [direct, reverse], [`${direct} %`, `${reverse} %`], direct, probe.email ? probe.email.toLowerCase() : null, probe.phone ?? null, limit],
  );
}
