/**
 * Connexion FÉDÉRÉE (Google) : le serveur web a déjà vérifié l'identité auprès du fournisseur (OAuth, e-mail vérifié) et
 * demande à iam d'ouvrir la session. Il n'y a donc pas de mot de passe à contrôler ; tout le reste est identique à
 * `login` (accès actif sous RLS, politique MFA — le défi / l'enrôlement reste exigé —, session, événement).
 *
 * Garanties
 *  - la route HTTP n'existe que si `IAM_SERVICE_SECRET` est défini et exige ce secret (comparaison à temps constant) :
 *    sans lui, n'importe quel appelant pourrait obtenir une session pour n'importe quel e-mail ;
 *  - AUCUNE création de compte : l'identité et son accès doivent exister (invitation, import). Un compte Google
 *    inconnu ne s'inscrit pas tout seul dans un établissement (le legacy créait un compte `student` à la volée) ;
 *  - `email_verified` du fournisseur est exigé par le contrat (`emailVerified: true`), pas supposé ;
 *  - mêmes plafonds de débit par IP que `login`, mêmes motifs d'échec journalisés (sans e-mail en clair).
 */
import { ForbiddenError, err, type AppError, type Result } from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { isPlausibleEmail, normalizeEmail } from "../domain/email";
import { limiterKey } from "../domain/tokens";
import * as identities from "../infrastructure/identity-repo";
import { TooManyAttemptsError, padToMinimum, startTimer, type IamDeps, type RequestMeta } from "./deps";
import { finishLogin, recordFailureInBackground } from "./login";
import type { LoginOutcome } from "./session-issue";

export interface FederatedLoginInput {
  provider: "google";
  email: string;
  tenantSlug?: string | undefined;
  activeRole?: string | undefined;
  deviceName?: string | undefined;
  meta: RequestMeta;
}

const noAccess = (): AppError => new ForbiddenError("Aucun accès actif pour ce compte.", { code: AuthErrorCodes.noActiveAccess });

export async function federatedLogin(deps: IamDeps, input: FederatedLoginInput): Promise<Result<LoginOutcome, AppError>> {
  const startedAt = startTimer();
  const result = await federatedInner(deps, input);
  if (!result.ok) await padToMinimum(deps, startedAt, deps.config.failureMinDurationMs);
  return result;
}

async function federatedInner(deps: IamDeps, input: FederatedLoginInput): Promise<Result<LoginOutcome, AppError>> {
  const { config, limiter } = deps;
  const email = normalizeEmail(input.email);
  const ip = input.meta.ip ?? "unknown";

  const window = await limiter.hit(limiterKey(config.keys.tokenHash, "login:ip", ip), config.loginIpLimit);
  if (!window.allowed) return err(new TooManyAttemptsError(window.retryAfterMs));
  if (!isPlausibleEmail(email)) return err(noAccess());

  const { identity, tenants } = await deps.systemDb.run(
    "iam.federated.lookup",
    async (tx) => {
      const found = await identities.findIdentityByEmail(tx, email);
      return { identity: found, tenants: found ? await identities.listTenantsOfIdentity(tx, found.id) : [] };
    },
    { readOnly: true },
  );

  const activeTenants = tenants.filter((t) => t.status === "active");
  const chosen = input.tenantSlug
    ? activeTenants.find((t) => t.slug === input.tenantSlug)
    : (activeTenants.find((t) => t.id === identity?.last_tenant_id) ?? activeTenants[0]);

  if (!identity || identity.status !== "active" || !chosen) {
    recordFailureInBackground(deps, {
      locked: false,
      tenantId: chosen?.id ?? null,
      reason: !identity ? "unknown_identity" : identity.status !== "active" ? "identity_disabled" : "no_active_access",
      email,
      identityId: identity?.id ?? null,
      meta: input.meta,
    });
    return err(noAccess());
  }

  return finishLogin(deps, {
    identity,
    tenant: chosen,
    tenants,
    activeRole: input.activeRole,
    deviceName: input.deviceName,
    meta: input.meta,
    upgradedHash: null,
    method: `federated:${input.provider}`,
    amr: ["fed"],
  });
}
