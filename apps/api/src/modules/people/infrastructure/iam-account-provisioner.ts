/**
 * Adaptateur du port `AccountProvisioner` de `people` vers les modules `iam` et `rbac`.
 *
 *  - `invite`   : `iam.provisionMember` (identité globale par e-mail + accès au tenant + INVITATION par e-mail à définir
 *    son mot de passe : jeton à usage unique, aucun mot de passe en clair) puis attribution du rôle système RBAC
 *    (`assignSystemRoleUseCase`, acteur `system` : c'est du provisioning) ;
 *  - `grantRole`: attribue un rôle système supplémentaire à une identité qui a déjà un accès (parent ET enseignant).
 *
 * `iam` est joint par structure (`app.iam.provisionMember`, posé à la racine par son `setup`) : `people` n'importe pas son
 * code. `rbac` est joint par son `index.ts` public.
 */
import { createSystemContext, err, ok, type AppError, type Clock, type Logger, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PgOutboxWriter, type TenantDb } from "@ecoledigitale/database";
import { assignSystemRoleUseCase, rbacAuditAdapter } from "../../rbac";
import type { ModuleRuntime } from "../../../platform/runtime";
import type { AccountProvisioner } from "../application/ports";

/** Sous-ensemble de `IamService` utilisé ici. */
export interface IamProvisioningLike {
  provisionMember(
    ctx: RequestContext,
    input: { email: string; roles: readonly string[]; sendInvitation?: boolean; invitedBy?: string | null; meta: { ip: string | null; userAgent: string | null; requestId: string } },
  ): Promise<Result<{ membershipId: string; identityId: string }, AppError>>;
}

export interface IamAccountProvisionerOptions {
  iam: IamProvisioningLike;
  tenantDb: TenantDb;
  clock: Clock;
  logger: Logger;
  audit: ModuleRuntime["auditPort"];
}

export function createIamAccountProvisioner(options: IamAccountProvisionerOptions): AccountProvisioner {
  const assignRole = async (ctx: RequestContext, identityId: string, role: string): Promise<Result<void, AppError>> => {
    const sys = createSystemContext(ctx.tenantId, ctx.requestId);
    const assigned = await options.tenantDb.run(sys, (tx) =>
      assignSystemRoleUseCase(
        { tx, clock: options.clock, outbox: new PgOutboxWriter(tx), audit: rbacAuditAdapter(options.audit), logger: options.logger },
        sys,
        { templateKey: role, userId: identityId, identityId },
      ),
    );
    return assigned.ok ? ok(undefined) : err(assigned.error);
  };

  return {
    async invite(ctx, input) {
      const member = await options.iam.provisionMember(ctx, {
        email: input.email,
        roles: input.roles,
        sendInvitation: true,
        invitedBy: ctx.userId,
        meta: { ip: null, userAgent: null, requestId: ctx.requestId },
      });
      if (!member.ok) return member;
      for (const role of input.roles) {
        const granted = await assignRole(ctx, member.value.identityId, role);
        if (!granted.ok) return granted;
      }
      return ok(member.value);
    },
    async grantRole(ctx, input) {
      return assignRole(ctx, input.identityId, input.role);
    },
  };
}
