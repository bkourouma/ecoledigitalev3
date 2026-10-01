/**
 * Création d'un rôle de CONNEXION applicatif pour le développement et les tests.
 *
 * `0001_roles.sql` ne crée que des rôles de groupe (`app_user`, `migrator`) sans LOGIN ni
 * mot de passe. Pour lancer l'API v2 en local il faut un rôle LOGIN membre de `app_user` :
 * cette fonction le crée avec un mot de passe ALÉATOIRE, renvoyé à l'appelant pour un
 * affichage unique. Rien n'est écrit sur disque.
 *
 * Refuse toute base dont le nom ne finit pas par `_dev`, `_test` ou `_local` : en
 * production, les rôles de connexion se créent par l'exploitation avec un secret injecté.
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { isSafeDatabaseName } from "@ecoledigitale/database";

export const DEFAULT_LOGIN_ROLE = "ed_v2_app";

const ROLE_NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;
const FORBIDDEN_ROLE_NAMES = new Set(["postgres", "app_user", "migrator", "public", "pg_monitor"]);
/** Alphabet base64url : sûr à insérer entre apostrophes dans un CREATE ROLE (aucune apostrophe, aucun backslash). */
const SAFE_SECRET_RE = /^[A-Za-z0-9_-]{16,}$/;

export class LoginRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginRoleError";
  }
}

export function generateRolePassword(): string {
  return randomBytes(24).toString("base64url");
}

/** Construit l'URL applicative à partir de l'URL d'administration (même hôte, port et base). */
export function applicationUrlFor(adminUrl: string, role: string, secret: string): string {
  const u = new URL(adminUrl);
  u.username = role;
  u.password = secret;
  return u.toString();
}

export interface CreateLoginRoleOptions {
  /** Connexion d'un rôle pouvant `CREATE ROLE` (V2_MIGRATOR_URL en développement). */
  adminUrl: string;
  role?: string;
  /** Si le rôle existe déjà : change son mot de passe au lieu de refuser. */
  rotate?: boolean;
  /** Injectable pour les tests. */
  generateSecret?: () => string;
}

export interface CreatedLoginRole {
  database: string;
  role: string;
  /** À AFFICHER UNE SEULE FOIS ; ne jamais journaliser ni persister. */
  secret: string;
  applicationUrl: string;
  rotated: boolean;
}

export async function createLoginRole(options: CreateLoginRoleOptions): Promise<CreatedLoginRole> {
  const role = options.role ?? DEFAULT_LOGIN_ROLE;
  if (!ROLE_NAME_RE.test(role) || FORBIDDEN_ROLE_NAMES.has(role) || role.startsWith("pg_")) {
    throw new LoginRoleError(`Nom de rôle refusé : "${role}" (minuscules/chiffres/_, 3 à 41 caractères, hors rôles réservés).`);
  }
  const secret = (options.generateSecret ?? generateRolePassword)();
  if (!SAFE_SECRET_RE.test(secret)) {
    throw new LoginRoleError("Mot de passe généré invalide (alphabet base64url, 16 caractères minimum attendu).");
  }

  const client = new Client({ connectionString: options.adminUrl, application_name: "ecoledigitale-v2-login-role" });
  await client.connect();
  try {
    const database = (await client.query("SELECT current_database() AS db")).rows[0]?.db as string;
    if (!isSafeDatabaseName(database)) {
      throw new LoginRoleError(
        `Base "${database}" refusée : cette commande ne s'exécute que sur une base dont le nom finit par _dev, _test ou _local. ` +
          "En production, créez le rôle de connexion via votre gestionnaire de secrets.",
      );
    }

    const appUser = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'");
    if (appUser.rows.length === 0) {
      throw new LoginRoleError('Le rôle "app_user" n\'existe pas : appliquez d\'abord `pnpm db:v2:migrate`.');
    }

    const existing = (
      await client.query(
        `SELECT r.rolsuper, r.rolbypassrls, pg_has_role(r.oid, 'app_user', 'member') AS member
           FROM pg_roles r WHERE r.rolname = $1`,
        [role],
      )
    ).rows[0] as { rolsuper: boolean; rolbypassrls: boolean; member: boolean } | undefined;

    if (existing) {
      if (!options.rotate) {
        throw new LoginRoleError(`Le rôle "${role}" existe déjà. Relancez avec --rotate pour changer son mot de passe.`);
      }
      if (existing.rolsuper || existing.rolbypassrls || !existing.member) {
        throw new LoginRoleError(`Le rôle "${role}" existe mais n'est pas un rôle applicatif sûr : rotation refusée.`);
      }
      await client.query(`ALTER ROLE "${role}" WITH LOGIN PASSWORD '${secret}'`);
    } else {
      await client.query(
        `CREATE ROLE "${role}" WITH LOGIN PASSWORD '${secret}' ` +
          "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT IN ROLE app_user",
      );
    }

    return {
      database,
      role,
      secret,
      applicationUrl: applicationUrlFor(options.adminUrl, role, secret),
      rotated: Boolean(existing),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
