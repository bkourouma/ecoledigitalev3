/**
 * Un compte par rôle système : direction des études, secrétariat, économe, éducateur, responsable des examens, chargé
 * d'admissions. La MFA n'est posée que là où le produit la recommande (rôles portant une permission sensible : `mfaRecommended`
 * des modèles de rôles) ; les autres comptes se connectent par mot de passe seul.
 */
import { SYSTEM_ROLE_TEMPLATES } from "../../../apps/api/src/modules/rbac/templates/system-roles";
import type { Actor } from "../actors";
import type { DemoKit } from "./kit";

export interface StaffActors {
  etudes: Actor;
  secretariat: Actor;
  econome: Actor;
  educateur: Actor;
  examens: Actor;
  admissions: Actor;
}

const mfaRecommended = (role: string): boolean => SYSTEM_ROLE_TEMPLATES.find((t) => t.key === role)?.mfaRecommended === true;

export async function addStaffAccounts(kit: DemoKit): Promise<StaffActors> {
  const { ctx } = kit;
  const slug = ctx.data.slug;
  const make = (systemRole: string, local: string): Promise<Actor> => ctx.accounts.staff(ctx.owner, systemRole, `${local}@${slug}.test`, systemRole, { mfa: mfaRecommended(systemRole) });
  const etudes = await make("directeur_etudes", "etudes");
  const secretariat = await make("secretariat", "secretariat");
  const econome = await make("econome", "econome");
  const educateur = await make("educateur", "educateur");
  const examens = await make("responsable_examens", "examens");
  const admissions = await make("admissions_officer", "admissions");
  kit.count("staffAccounts", 6);
  return { etudes, secretariat, econome, educateur, examens, admissions };
}
