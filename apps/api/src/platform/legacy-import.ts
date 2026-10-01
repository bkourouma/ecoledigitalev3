/**
 * Import des utilisateurs LEGACY vers `iam` (identités globales + accès par tenant) et `rbac` (assignations).
 *
 *   pnpm iam:import-legacy [--dry-run] [--tenant <slug>] [--report <fichier>]     (scripts/iam/import-legacy.ts)
 *
 * Principes
 *  - LECTURE SEULE côté legacy : la connexion est ouverte en `default_transaction_read_only=on`, une écriture
 *    accidentelle échouerait. Les données de production ne sont jamais modifiées ;
 *  - IDEMPOTENT : relancer ne crée rien de plus (accès existant reconnu, assignation déjà posée non rejouée).
 *    L'import CRÉE ce qui manque ; il ne MODIFIE PAS un accès existant (iam devient l'autorité) : un écart de rôles
 *    est signalé (`role_drift`), pas écrasé ;
 *  - rôles : exactement ceux que le login legacy donnerait (`loadUserAuthContextById` : `user_roles` + rôles déduits
 *    des profils enseignant / élève / parent), écrits tels quels dans l'accès IAM (clés legacy : `admin`, `owner`…),
 *    puis assignations RBAC par `legacyRoleToTemplate` (`admin` -> directeur + secretariat + econome…) ;
 *  - mots de passe : le hash bcrypt est conservé tel quel (`provisionMember({ passwordHash })`) et re-haché en scrypt
 *    au premier login réussi. Aucun mot de passe n'est lu, affiché, journalisé ou écrit dans le rapport ;
 *  - super-admin : hors périmètre (table `super_admin_users` jamais lue ; rôle `super_admin` ignoré et signalé) ;
 *  - comptes techniques (`users.is_technical_account`) : importés SEULEMENT si un mot de passe est fourni
 *    (`IAM_IMPORT_TECHNICAL_PASSWORD`, jamais de défaut, soumis à la politique de mot de passe d'iam) ; leur hash
 *    legacy n'est jamais repris (valeur par défaut historique, potentiellement connue) ;
 *  - AUCUNE invitation par e-mail : l'import ne notifie personne (`sendInvitation: false`).
 *
 * Cas ambigus rapportés (jamais devinés) : voir `AmbiguityKind`.
 */
import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createSystemContext, newId, type Clock, type Logger, type RequestContext } from "@ecoledigitale/kernel";
import { PgOutboxWriter, type SystemDb, type TenantDb } from "@ecoledigitale/database";
import { LEGACY_ROLE_KEYS } from "@ecoledigitale/contracts/src/v2/iam-legacy-roles";
import type { IamService } from "../modules/iam";
import { assignSystemRoleUseCase, legacyRoleToTemplate, listAssignmentsUseCase, noopAudit } from "../modules/rbac";

export type AmbiguityKind =
  /** Même e-mail dans plusieurs établissements : UNE identité, plusieurs accès ; le mot de passe retenu est celui du compte le plus ancien. */
  | "shared_email"
  /** Plusieurs comptes de même e-mail dans UN établissement : le plus ancien est importé, les autres ignorés. */
  | "duplicate_in_tenant"
  /** Rôle legacy sans équivalent RBAC (rôle personnalisé…) : conservé dans l'accès, aucune assignation RBAC. */
  | "unknown_role"
  /** Rôle ignoré parce que hors périmètre (`super_admin`) ou non représentable (clé invalide). */
  | "role_ignored"
  /** Compte sans aucun rôle : le login legacy échoue déjà ; ignoré. */
  | "no_roles"
  /** Compte désactivé dans le legacy : ignoré (relancer après réactivation). */
  | "inactive_user"
  /** E-mail non valide pour iam : ignoré. */
  | "invalid_email"
  /** Compte sans mot de passe (connexion sociale…) : accès créé sans mot de passe, aucune invitation envoyée. */
  | "no_password_hash"
  /** Hash illisible (ni bcrypt) : traité comme « sans mot de passe ». */
  | "unusable_password_hash"
  /** Compte technique non importé faute de `IAM_IMPORT_TECHNICAL_PASSWORD`. */
  | "technical_account_skipped"
  /** Compte technique importé avec le mot de passe fourni par l'environnement. */
  | "technical_account_imported"
  /** Établissement legacy absent de `kernel.tenants` (démarrer l'API une fois : synchronisation + rattrapage). */
  | "tenant_not_in_v2"
  /** Établissement inactif côté v2. */
  | "tenant_inactive"
  /** Accès IAM existant dont les rôles diffèrent de ceux du legacy : non modifié. */
  | "role_drift"
  /** Assignation RBAC impossible (rôles système non instanciés…). */
  | "rbac_failed"
  /** Erreur inattendue sur ce compte. */
  | "import_error";

export interface Ambiguity {
  kind: AmbiguityKind;
  tenantSlug: string | null;
  email: string | null;
  legacyUserId: string | null;
  detail: string;
}

export interface TenantReport {
  tenantId: string;
  slug: string;
  status: "imported" | "skipped";
  skipReason?: AmbiguityKind;
  usersSeen: number;
  identitiesCreated: number;
  membershipsCreated: number;
  membershipsExisting: number;
  assignmentsGranted: number;
  assignmentsExisting: number;
  skipped: number;
}

export interface ImportReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  totals: Omit<TenantReport, "tenantId" | "slug" | "status" | "skipReason"> & { tenants: number; tenantsSkipped: number };
  tenants: TenantReport[];
  ambiguities: Ambiguity[];
  /** Compte par type d'ambiguïté (lecture rapide). */
  ambiguityCounts: Partial<Record<AmbiguityKind, number>>;
}

export interface ImportDeps {
  /** Pool LEGACY (lecture seule garantie par `openLegacyPool`). */
  legacy: Pick<Pool, "query" | "connect">;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  iam: Pick<IamService, "provisionMember">;
  clock: Clock;
  logger: Logger;
}

export interface ImportOptions {
  dryRun?: boolean;
  /** Limite l'import à un établissement (slug legacy). */
  tenantSlug?: string;
  /** Mot de passe des comptes techniques (jamais de défaut). */
  technicalPassword?: string;
}

interface LegacyTenantRow {
  id: string;
  slug: string;
  is_active: boolean;
}

interface LegacyUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  is_active: boolean;
  is_technical: boolean;
  created_at: Date;
}

const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const ROLE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Connexion legacy en LECTURE SEULE (toute écriture échoue côté serveur). */
export async function openLegacyPool(connectionString: string): Promise<Pool> {
  const { Pool: PgPool } = await import("pg");
  return new PgPool({ connectionString, max: 2, application_name: "iam-import-legacy", options: "-c default_transaction_read_only=on" });
}

const normEmail = (value: string): string => value.normalize("NFKC").trim().toLowerCase();

async function hasColumn(client: Pick<PoolClient, "query">, table: string, column: string): Promise<boolean> {
  const r = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2", [table, column]);
  return (r.rowCount ?? 0) > 0;
}

export async function importLegacyUsers(deps: ImportDeps, options: ImportOptions = {}): Promise<ImportReport> {
  const startedAt = deps.clock.now();
  const dryRun = options.dryRun === true;
  const ambiguities: Ambiguity[] = [];
  const note = (kind: AmbiguityKind, tenantSlug: string | null, email: string | null, legacyUserId: string | null, detail: string): void => {
    ambiguities.push({ kind, tenantSlug, email, legacyUserId, detail });
  };

  // Le service d'authentification legacy exige JWT_SECRET à l'import (il signe des jetons) ; l'import n'en signe aucun.
  // Valeur jetable propre à ce processus, jamais utilisée pour signer quoi que ce soit.
  process.env.JWT_SECRET ??= randomBytes(32).toString("hex");
  // Chargement par spécificateur NON littéral : le service legacy n'est pas écrit pour les options strictes du
  // programme TypeScript de la plateforme v2 (tsconfig.v2.json) ; on ne le fait pas entrer dans ce programme.
  const legacyAuthService = "../services/user-auth.service";
  const { loadUserAuthContextById } = (await import(/* @vite-ignore */ legacyAuthService)) as {
    loadUserAuthContextById(client: PoolClient, userId: string, requestedRole?: string | null): Promise<{ availableRoles: string[] } | null>;
  };

  const client = (await deps.legacy.connect()) as PoolClient;
  try {
    // RLS legacy éventuelle : l'import lit tous les établissements (même mécanisme que le login legacy).
    await client.query("SELECT set_config('app.super_admin', 'true', false), set_config('app.tenant_id', '', false), set_config('app.current_tenant_id', '', false)");
    const technicalColumn = await hasColumn(client, "users", "is_technical_account");
    const activeColumn = await hasColumn(client, "users", "is_active");

    const legacyTenants = (
      await client.query<LegacyTenantRow>("SELECT id, slug, COALESCE(is_active, true) AS is_active FROM tenants ORDER BY slug")
    ).rows.filter((t) => !options.tenantSlug || t.slug === options.tenantSlug);

    const v2Tenants = new Map(
      (await deps.systemDb.run("iam.import-legacy.tenants", (tx) => tx.many<{ id: string; status: string }>("SELECT id, status FROM kernel.tenants"), { readOnly: true })).map((t) => [t.id, t.status]),
    );

    // E-mails présents dans plusieurs établissements : une identité, plusieurs accès ; le hash du compte le plus ancien l'emporte.
    const shared = (
      await client.query<{ email: string }>("SELECT LOWER(email) AS email FROM users WHERE email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(DISTINCT tenant_id) > 1")
    ).rows.map((r) => r.email);
    const sharedHash = new Map<string, string | null>();
    if (shared.length > 0) {
      const rows = await client.query<{ email: string; password_hash: string | null }>(
        "SELECT DISTINCT ON (LOWER(email)) LOWER(email) AS email, password_hash FROM users WHERE LOWER(email) = ANY($1::text[]) ORDER BY LOWER(email), created_at ASC, id ASC",
        [shared],
      );
      for (const r of rows.rows) sharedHash.set(normEmail(r.email), r.password_hash);
    }
    const sharedSet = new Set(shared.map(normEmail));
    const sharedNoted = new Set<string>();

    // Identités déjà présentes (e-mails) : sert à compter les identités RÉELLEMENT créées (un e-mail partagé n'en crée qu'une).
    const knownIdentities = new Set(
      (await deps.systemDb.run("iam.import-legacy.identities", (tx) => tx.many<{ email: string }>("SELECT email FROM iam.identities"), { readOnly: true })).map((r) => normEmail(r.email)),
    );

    const tenantReports: TenantReport[] = [];
    for (const tenant of legacyTenants) {
      const report: TenantReport = {
        tenantId: tenant.id, slug: tenant.slug, status: "imported", usersSeen: 0, identitiesCreated: 0, membershipsCreated: 0,
        membershipsExisting: 0, assignmentsGranted: 0, assignmentsExisting: 0, skipped: 0,
      };
      tenantReports.push(report);

      const v2Status = v2Tenants.get(tenant.id);
      if (v2Status === undefined) {
        report.status = "skipped";
        report.skipReason = "tenant_not_in_v2";
        note("tenant_not_in_v2", tenant.slug, null, null, "Établissement absent de kernel.tenants : démarrez l'API (synchronisation + rattrapage des tenants legacy) puis relancez.");
        continue;
      }
      if (v2Status !== "active") {
        report.status = "skipped";
        report.skipReason = "tenant_inactive";
        note("tenant_inactive", tenant.slug, null, null, `Établissement ${v2Status} côté v2.`);
        continue;
      }

      // Accès déjà présents dans iam (par e-mail) : lecture système sur ce tenant.
      const existing = new Map(
        (
          await deps.systemDb.runForTenant(
            "iam.import-legacy.members",
            tenant.id,
            (tx) =>
              tx.many<{ identity_id: string; email: string; roles: string[]; status: string }>(
                "SELECT m.identity_id, i.email, m.roles, m.status FROM iam.memberships m JOIN iam.identities i ON i.id = m.identity_id WHERE m.tenant_id = $1",
                [tenant.id],
              ),
            { readOnly: true },
          )
        ).map((m) => [normEmail(m.email), m] as const),
      );

      const users = (
        await client.query<LegacyUserRow>(
          `SELECT id, email, password_hash, ${activeColumn ? "COALESCE(is_active, true)" : "true"} AS is_active,
                  ${technicalColumn ? "COALESCE(is_technical_account, false)" : "false"} AS is_technical, created_at
             FROM users WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC`,
          [tenant.id],
        )
      ).rows;

      const seenEmails = new Set<string>();
      const ctx = createSystemContext(tenant.id, newId());

      for (const user of users) {
        report.usersSeen += 1;
        const email = normEmail(user.email ?? "");
        const skip = (kind: AmbiguityKind, detail: string): void => {
          report.skipped += 1;
          note(kind, tenant.slug, email || null, user.id, detail);
        };

        try {
          if (!EMAIL_RE.test(email) || email.length > 254) {
            skip("invalid_email", "Adresse e-mail non valide pour iam.");
            continue;
          }
          if (seenEmails.has(email)) {
            skip("duplicate_in_tenant", "Plusieurs comptes de même e-mail dans cet établissement : le plus ancien est importé, celui-ci est ignoré.");
            continue;
          }
          seenEmails.add(email);
          if (!user.is_active) {
            skip("inactive_user", "Compte désactivé dans le legacy.");
            continue;
          }

          // Rôles = ce que le login legacy donnerait.
          let legacyRoles: string[];
          try {
            const auth = await loadUserAuthContextById(client, user.id);
            legacyRoles = auth?.availableRoles ?? [];
          } catch {
            legacyRoles = [];
          }
          const kept: string[] = [];
          for (const role of legacyRoles) {
            const key = role.trim().toLowerCase();
            if (key === "super_admin") {
              note("role_ignored", tenant.slug, email, user.id, "Rôle super_admin ignoré (opérateurs de la plateforme : hors périmètre).");
              continue;
            }
            if (!ROLE_RE.test(key)) {
              note("role_ignored", tenant.slug, email, user.id, `Clé de rôle non représentable dans iam : « ${role} ».`);
              continue;
            }
            if (!LEGACY_ROLE_KEYS.includes(key) && legacyRoleToTemplate(key).length === 0) {
              note("unknown_role", tenant.slug, email, user.id, `Rôle « ${key} » sans équivalent RBAC : conservé dans l'accès, aucune assignation RBAC.`);
            }
            if (!kept.includes(key)) kept.push(key);
          }
          if (kept.length === 0) {
            skip("no_roles", "Aucun rôle exploitable (le login legacy échoue déjà pour ce compte).");
            continue;
          }

          if (sharedSet.has(email) && !sharedNoted.has(email)) {
            sharedNoted.add(email);
            note("shared_email", null, email, null, "E-mail présent dans plusieurs établissements : une identité, plusieurs accès. Le mot de passe retenu est celui du compte LE PLUS ANCIEN ; les autres mots de passe ne seront plus valides (réinitialisation).");
          }

          // Mot de passe : jamais de défaut.
          let passwordHash: string | undefined;
          let password: string | undefined;
          if (user.is_technical) {
            if (!options.technicalPassword) {
              skip("technical_account_skipped", "Compte technique non importé : définissez IAM_IMPORT_TECHNICAL_PASSWORD (aucun mot de passe par défaut).");
              continue;
            }
            password = options.technicalPassword;
            note("technical_account_imported", tenant.slug, email, user.id, "Compte technique importé avec le mot de passe fourni par l'environnement (son hash legacy n'est pas repris).");
          } else {
            const candidate = sharedSet.has(email) ? (sharedHash.get(email) ?? null) : user.password_hash;
            if (!candidate) note("no_password_hash", tenant.slug, email, user.id, "Aucun mot de passe : accès créé sans mot de passe, aucune invitation envoyée (mot de passe oublié, ou connexion sociale).");
            else if (!BCRYPT.test(candidate)) note("unusable_password_hash", tenant.slug, email, user.id, "Hash de mot de passe non reconnu (ni bcrypt) : accès créé sans mot de passe.");
            else passwordHash = candidate;
          }

          // 1) identité + accès
          let identityId: string | undefined;
          const have = existing.get(email);
          if (have) {
            identityId = have.identity_id;
            report.membershipsExisting += 1;
            const same = [...have.roles].sort().join(",") === [...kept].sort().join(",");
            if (!same) note("role_drift", tenant.slug, email, user.id, `Rôles IAM [${have.roles.join(", ")}] ≠ rôles legacy [${kept.join(", ")}] : accès existant non modifié.`);
            if (have.status !== "active") note("role_drift", tenant.slug, email, user.id, `Accès IAM « ${have.status} » alors que le compte legacy est actif : non modifié.`);
          } else if (dryRun) {
            report.membershipsCreated += 1;
            if (!knownIdentities.has(email)) {
              report.identitiesCreated += 1;
              knownIdentities.add(email);
            }
          } else {
            const out = await deps.iam.provisionMember(ctx, {
              email,
              roles: kept,
              ...(password !== undefined ? { password } : passwordHash !== undefined ? { passwordHash } : {}),
              sendInvitation: false,
              invitedBy: null,
              meta: { ip: null, userAgent: "iam-import-legacy", requestId: ctx.requestId },
            });
            if (!out.ok) {
              if (out.error.code === "iam.membership_exists") {
                report.membershipsExisting += 1; // course avec un autre processus : déjà importé
                continue;
              }
              skip("import_error", `provisionMember a échoué : ${out.error.code}.`);
              continue;
            }
            identityId = out.value.identityId;
            report.membershipsCreated += 1;
            if (!knownIdentities.has(email)) {
              report.identitiesCreated += 1;
              knownIdentities.add(email);
            }
          }

          // 2) assignations RBAC par `legacyRoleToTemplate`
          const templates = [...new Set(kept.flatMap((role) => legacyRoleToTemplate(role)))];
          if (templates.length > 0 && identityId === undefined) {
            report.assignmentsGranted += templates.length; // simulation : l'accès serait créé avec ces assignations
          } else if (templates.length > 0 && identityId !== undefined) {
            const res = await assignTemplates(deps, ctx, identityId, templates, dryRun);
            if (res.ok) {
              report.assignmentsGranted += res.granted;
              report.assignmentsExisting += res.existing;
            } else {
              note("rbac_failed", tenant.slug, email, user.id, `Assignation RBAC impossible : ${res.code}.`);
            }
          }
        } catch (e) {
          skip("import_error", `Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
        }
      }
    }

    const finishedAt = deps.clock.now();
    const totals = tenantReports.reduce(
      (acc, t) => ({
        usersSeen: acc.usersSeen + t.usersSeen,
        identitiesCreated: acc.identitiesCreated + t.identitiesCreated,
        membershipsCreated: acc.membershipsCreated + t.membershipsCreated,
        membershipsExisting: acc.membershipsExisting + t.membershipsExisting,
        assignmentsGranted: acc.assignmentsGranted + t.assignmentsGranted,
        assignmentsExisting: acc.assignmentsExisting + t.assignmentsExisting,
        skipped: acc.skipped + t.skipped,
        tenants: acc.tenants + (t.status === "imported" ? 1 : 0),
        tenantsSkipped: acc.tenantsSkipped + (t.status === "skipped" ? 1 : 0),
      }),
      { usersSeen: 0, identitiesCreated: 0, membershipsCreated: 0, membershipsExisting: 0, assignmentsGranted: 0, assignmentsExisting: 0, skipped: 0, tenants: 0, tenantsSkipped: 0 },
    );
    const ambiguityCounts: ImportReport["ambiguityCounts"] = {};
    for (const a of ambiguities) ambiguityCounts[a.kind] = (ambiguityCounts[a.kind] ?? 0) + 1;
    return { dryRun, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), totals, tenants: tenantReports, ambiguities, ambiguityCounts };
  } finally {
    client.release();
  }
}

async function assignTemplates(
  deps: ImportDeps,
  ctx: RequestContext,
  identityId: string,
  templates: readonly string[],
  dryRun: boolean,
): Promise<{ ok: true; granted: number; existing: number } | { ok: false; code: string }> {
  return deps.tenantDb.run(ctx, async (tx) => {
    const useCaseDeps = { tx, clock: deps.clock, outbox: new PgOutboxWriter(tx), audit: noopAudit, logger: deps.logger };
    const current = await listAssignmentsUseCase(useCaseDeps, ctx, { userId: identityId, limit: 500 });
    const has = new Set(current.ok ? current.value.filter((a) => a.scopeType === "tenant").map((a) => a.roleKey) : []);
    let granted = 0;
    let existing = 0;
    for (const templateKey of templates) {
      if (has.has(templateKey)) {
        existing += 1;
        continue;
      }
      if (dryRun) {
        granted += 1;
        continue;
      }
      const res = await assignSystemRoleUseCase(useCaseDeps, ctx, { templateKey, userId: identityId, identityId });
      if (!res.ok) return { ok: false as const, code: res.error.code };
      granted += 1;
    }
    return { ok: true as const, granted, existing };
  });
}
