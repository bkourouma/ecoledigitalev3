/**
 * Annuaire minimal des accès d'un tenant pour les autres modules (adaptateurs de plateforme) : e-mail d'une identité
 * MEMBRE du tenant du contexte. Sert de repli de nom d'affichage quand aucune personne (`people`) n'est liée au compte.
 * Lecture seule ; une identité qui n'est pas membre du tenant (ou inconnue) est absente du résultat.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";

export async function getMemberEmails(db: Pick<TenantDb, "run">, ctx: RequestContext, identityIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(identityIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.run(
    ctx,
    (tx) =>
      tx.many<{ identity_id: string; email: string }>(
        `SELECT m.identity_id, i.email
           FROM iam.memberships m JOIN iam.identities i ON i.id = m.identity_id
          WHERE m.tenant_id = $1 AND m.identity_id = ANY($2::uuid[])`,
        [ctx.tenantId, unique],
      ),
    { readOnly: true },
  );
  return new Map(rows.map((r) => [r.identity_id, r.email]));
}
