/**
 * Liaison personne <-> identité IAM et comptes de portail (élève, parent, personnel).
 *
 * Une personne n'a PAS besoin de compte pour exister. Le compte est créé par le module `iam` (port `AccountProvisioner`)
 * sous forme d'une INVITATION à définir son mot de passe (jeton à usage unique) : aucun mot de passe n'est généré, stocké
 * ni renvoyé ici. Une personne cumulant plusieurs qualités (parent ET enseignant) a UNE identité et plusieurs rôles
 * système : le second rôle est accordé à l'identité existante (`grantRole`), jamais par un second compte.
 */
import { err, newId, ok, ValidationError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import { PEOPLE_EVENTS } from "@ecoledigitale/contracts/src/v2/people";
import { PeopleErrors } from "../domain/errors";
import { getPerson, setIdentity } from "../infrastructure/persons-repo";
import { getStaffCategory } from "../infrastructure/reference-repo";
import { findGuardianByPerson } from "../infrastructure/guardians-repo";
import { getMembership, upsertMembership } from "../infrastructure/projection-repo";
import { findStaffByPerson } from "../infrastructure/staff-repo";
import { findStudentByPerson } from "../infrastructure/students-repo";
import { EventBuffer, inTx, type PeopleDeps } from "./deps";

export type PersonQuality = "STUDENT" | "GUARDIAN" | "STAFF";

export interface AccountOutcome {
  personId: string;
  identityId: string;
  status: string;
  invited: boolean;
  role: string;
}

/** Rôle système par défaut selon la qualité visée ; le personnel dépend de la catégorie (donnée). */
async function defaultRole(tx: Tx, tenantId: string, personId: string, quality: PersonQuality): Promise<string | null> {
  if (quality === "STUDENT") return "eleve";
  if (quality === "GUARDIAN") return "parent";
  const staff = await findStaffByPerson(tx, tenantId, personId);
  if (!staff) return null;
  const cat = await getStaffCategory(tx, tenantId, staff.categoryCode);
  if (cat?.canTeach) return "enseignant";
  if (cat?.canSupervise) return "educateur";
  return null;
}

/** Qualité d'une personne quand l'appelant ne la précise pas : élève, sinon tuteur, sinon personnel (ambiguïté ⇒ le rôle est exigé). */
async function inferQuality(tx: Tx, tenantId: string, personId: string): Promise<PersonQuality | null> {
  const [student, guardian, staff] = await Promise.all([findStudentByPerson(tx, tenantId, personId), findGuardianByPerson(tx, tenantId, personId), findStaffByPerson(tx, tenantId, personId)]);
  const found: PersonQuality[] = [];
  if (student) found.push("STUDENT");
  if (guardian) found.push("GUARDIAN");
  if (staff) found.push("STAFF");
  return found.length === 1 ? (found[0] as PersonQuality) : null;
}

/** Qualités d'une personne (élève, tuteur, personnel) : sert à vérifier que l'acteur a le droit d'agir sur CETTE qualité. */
export async function getPersonQualities(deps: PeopleDeps, ctx: RequestContext, personId: string): Promise<Result<PersonQuality[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const person = await getPerson(tx, ctx.tenantId, personId);
      if (!person) return err(PeopleErrors.personNotFound(personId));
      const [student, guardian, staff] = await Promise.all([findStudentByPerson(tx, ctx.tenantId, personId), findGuardianByPerson(tx, ctx.tenantId, personId), findStaffByPerson(tx, ctx.tenantId, personId)]);
      const out: PersonQuality[] = [];
      if (student) out.push("STUDENT");
      if (guardian) out.push("GUARDIAN");
      if (staff) out.push("STAFF");
      return ok(out);
    },
    { readOnly: true },
  );
}

/**
 * Crée l'accès de portail d'une personne (ou accorde un rôle supplémentaire à son identité existante) et la lie.
 *
 * Trois phases, car le port `AccountProvisioner` ouvre ses PROPRES transactions (iam crée l'identité, rbac attribue le
 * rôle système sous un contexte `system`) et ne peut pas s'imbriquer dans la nôtre : (1) lecture et décision, (2) appel du
 * port, (3) liaison de l'identité à la personne + projection + événement + audit, atomiques. Si la phase 3 échouait après
 * la phase 2, l'accès existe côté iam : une relance répond `people.account_exists` et la liaison se fait par
 * `linkPersonToIdentity` (l'identité est connue par la projection des événements iam).
 */
/**
 * Rôles que l'invitation de portail peut accorder. SEC-06 : le rôle est attribué sous un contexte `system` (sans contrôle
 * anti-escalade) ; accepter n'importe quelle clé permettait à un secrétariat (`guardian.manage`) de s'attribuer `owner`.
 */
export const PORTAL_ROLES: readonly string[] = Object.freeze(["parent", "eleve", "enseignant", "educateur"]);

export async function provisionPortalAccount(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: { personId: string; quality?: PersonQuality | undefined; role?: string | undefined; channel?: "EMAIL" },
): Promise<Result<AccountOutcome, AppError>> {
  const accounts = deps.accounts;
  if (!accounts) return err(PeopleErrors.accountProvisioningUnavailable());
  if (input.role !== undefined && !PORTAL_ROLES.includes(input.role)) {
    return err(ValidationError.field("role", "Ce rôle ne peut pas être accordé par une invitation de portail.", "role_not_portal"));
  }

  // Phase 1 : lecture et décision.
  const plan = await inTx(
    deps,
    ctx,
    async (tx) => {
      const person = await getPerson(tx, ctx.tenantId, input.personId);
      if (!person) return err(PeopleErrors.personNotFound(input.personId));
      if (person.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
      const quality = input.quality ?? (input.role ? null : await inferQuality(tx, ctx.tenantId, person.personId));
      const role = input.role ?? (quality ? await defaultRole(tx, ctx.tenantId, person.personId, quality) : null);
      if (!role) return err(ValidationError.field("role", "Précisez le rôle à accorder (qualité de la personne ambiguë ou catégorie sans portail).", "role_required"));
      if (!person.identityId && !person.email) return err(PeopleErrors.accountEmailRequired());
      return ok({ personId: person.personId, identityId: person.identityId, email: person.email, role });
    },
    { readOnly: true },
  );
  if (!plan.ok) return plan;
  const { personId, identityId: existingIdentity, email, role } = plan.value;

  // Phase 2 : le module iam (invitation) / rbac (rôle système), hors de notre transaction.
  let identityId: string;
  let membershipId: string | null = null;
  let invited = false;
  if (existingIdentity) {
    const granted = await accounts.grantRole(ctx, { identityId: existingIdentity, role });
    if (!granted.ok) return granted;
    identityId = existingIdentity;
  } else {
    const created = await accounts.invite(ctx, { email: email as string, roles: [role] });
    if (!created.ok) return err(created.error.code === "iam.membership_exists" ? PeopleErrors.accountExists() : created.error);
    identityId = created.value.identityId;
    membershipId = created.value.membershipId;
    invited = true;
  }

  // Phase 3 : liaison, projection, événement et audit dans une même transaction.
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const buffer = new EventBuffer(deps, ctx);
    if (invited) {
      const person = await getPerson(tx, ctx.tenantId, personId, { forUpdate: true });
      if (!person) return err(PeopleErrors.personNotFound(personId));
      if (person.identityId && person.identityId !== identityId) return err(PeopleErrors.identityAlreadyLinked());
      try {
        await setIdentity(tx, ctx.tenantId, personId, identityId, now);
      } catch (e) {
        if (isUniqueViolation(e)) return err(PeopleErrors.identityAlreadyLinked());
        throw e;
      }
      // État immédiatement lisible ; l'événement iam.membership.created le confirmera (ordre protégé par l'horodatage).
      await upsertMembership(tx, ctx.tenantId, { identityId, membershipId, status: "active", roles: [role] }, newId(), now);
      buffer.add(PEOPLE_EVENTS.personIdentityLinked, { v: 1, personId, identityId, via: "invitation" }, { type: "person", id: personId });
      buffer.audit({ action: "people.person.account_invited", entity: "person", entityId: personId, severity: "notice", metadata: { identityId, role, channel: input.channel ?? "EMAIL" } });
    } else {
      buffer.audit({ action: "people.person.role_granted", entity: "person", entityId: personId, severity: "notice", metadata: { identityId, role } });
    }
    await buffer.flush(tx);
    const membership = await getMembership(tx, ctx.tenantId, identityId);
    return ok({ personId, identityId, status: membership?.status ?? "unknown", invited, role });
  });
}

/**
 * Lie manuellement une personne à une identité qui a DÉJÀ un accès dans ce tenant (connu par la projection des événements
 * `iam.membership.*`). Refus si l'identité est inconnue du tenant, déjà liée à une autre personne, ou si la personne a déjà
 * une identité.
 */
export async function linkPersonToIdentity(deps: PeopleDeps, ctx: RequestContext, personId: string, identityId: string): Promise<Result<{ personId: string; identityId: string; status: string }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const person = await getPerson(tx, ctx.tenantId, personId, { forUpdate: true });
    if (!person) return err(PeopleErrors.personNotFound(personId));
    if (person.anonymizedAt) return err(PeopleErrors.alreadyAnonymized());
    if (person.identityId) return err(PeopleErrors.identityAlreadyLinked());
    const membership = await getMembership(tx, ctx.tenantId, identityId);
    if (!membership) return err(PeopleErrors.identityUnknown());
    try {
      await setIdentity(tx, ctx.tenantId, personId, identityId, now);
    } catch (e) {
      if (isUniqueViolation(e)) return err(PeopleErrors.identityAlreadyLinked());
      throw e;
    }
    const buffer = new EventBuffer(deps, ctx);
    buffer.add(PEOPLE_EVENTS.personIdentityLinked, { v: 1, personId, identityId, via: "manual" }, { type: "person", id: personId });
    buffer.audit({ action: "people.person.identity_linked", entity: "person", entityId: personId, severity: "notice", metadata: { identityId } });
    await buffer.flush(tx);
    return ok({ personId, identityId, status: membership.status });
  });
}
