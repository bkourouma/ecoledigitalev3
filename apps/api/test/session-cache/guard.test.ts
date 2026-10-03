/**
 * Garde statique du cache de verdict de session : AUCUN code applicatif ne doit écrire une donnée du verdict
 * (`iam.sessions`, `iam.identities`, `iam.memberships`, `kernel.tenants`) sans passer par un dépôt qui invalide le
 * cache (`invalidateSessionVerdict`). Un nouvel écrivain hors de cette liste fait échouer la CI : il doit soit appeler
 * le port d'invalidation, soit être ajouté ici AVEC sa justification (écriture sans effet sur un verdict existant).
 *
 * Ne couvre pas : le SQL direct (psql, scripts d'exploitation, graines de démonstration, tests) ; voir
 * `docs/architecture/perf-report.md` §10.8 (procédure : `DEL <préfixe>t:g` ou `V2_SESSION_CACHE=off`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readVerdictCacheEnv } from "../../src/modules/iam";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");

const WRITE = /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(iam\.(sessions|identities|memberships)|kernel\.tenants)\b/gi;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "migrations" || name === "test" || name === "tests" || name === "__tests__") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}

const roots = ["apps/api/src", "apps/worker/src", "packages/kernel/src", "packages/database/src", "packages/contracts/src"].map((r) => join(repo, r));
const rel = (p: string): string => relative(repo, p).split(sep).join("/");

/** Fichiers autorisés à écrire ces tables, et fonctions exportées dont l'écriture ne change PAS un verdict existant. */
const IGNORED: Record<string, string> = {
  "apps/api/src/platform/module-scaffold-templates.ts": "gabarits de TESTS générés pour un nouveau module (INSERT d un tenant jetable dans une base de test)",
};

const REPOS: Record<string, { invalidates: boolean; exempt: Record<string, string>; fileLevel?: boolean }> = {
  "apps/api/src/modules/iam/infrastructure/session-repo.ts": {
    invalidates: true,
    exempt: {
      insertSession: "nouvelle session : aucun verdict antérieur ne la concerne",
      touchSession: "last_seen_at / last_ip : hors verdict",
      purgeExpired: "ne supprime que des sessions déjà expirées ou révoquées (déjà refusées)",
    },
  },
  "apps/api/src/modules/iam/infrastructure/identity-repo.ts": {
    invalidates: true,
    exempt: {
      insertIdentity: "nouvelle identité",
      replacePasswordHash: "re-hachage transparent : même mot de passe, hors verdict",
      recordLogin: "dernier login : hors verdict",
      setMfaPending: "secret en attente : hors verdict",
      replaceMfaSecret: "rotation de clé de chiffrement : hors verdict",
      advanceMfaStep: "anti-rejeu TOTP : hors verdict",
      markEmailVerified: "e-mail vérifié : hors verdict",
    },
  },
  "apps/api/src/modules/iam/infrastructure/membership-repo.ts": {
    invalidates: true,
    exempt: { insertMembership: "nouvel accès (ON CONFLICT DO NOTHING) : aucune session existante ne le référence" },
  },
  "apps/api/src/modules/tenancy/infrastructure/tenants-repository.ts": {
    invalidates: true,
    exempt: { insertTenant: "nouveau tenant : aucune session" },
  },
  // Écrit par lots (une constante SQL + writeTenants) : contrôle au niveau du fichier.
  "apps/api/src/platform/tenant-sync.ts": { invalidates: true, exempt: {}, fileLevel: true },
};

describe("garde : tout écrivain d'une donnée du verdict de session invalide le cache", () => {
  it("aucun fichier source hors de la liste ne contient d'écriture sur ces tables", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const text = readFileSync(file, "utf8");
        WRITE.lastIndex = 0;
        if (WRITE.test(text) && !(rel(file) in REPOS) && !(rel(file) in IGNORED)) offenders.push(rel(file));
      }
    }
    expect(offenders, "nouvel écrivain du verdict : appelez invalidateSessionVerdict (kernel) et déclarez-le dans ce test").toEqual([]);
  });

  for (const [file, spec] of Object.entries(REPOS)) {
    it(`${file} : chaque fonction qui écrit le verdict appelle le port d'invalidation`, () => {
      const text = readFileSync(join(repo, file), "utf8");
      if (spec.fileLevel) {
        expect(/invalidateSessionVerdict\(/.test(text), `${file} doit appeler invalidateSessionVerdict`).toBe(true);
        return;
      }
      // Découpe par fonction de premier niveau (exportée ou non).
      const parts = text.split(/^(?=(?:export )?(?:async )?function \w+)/m);
      const writers: string[] = [];
      for (const part of parts) {
        const name = /^(?:export )?(?:async )?function (\w+)/.exec(part)?.[1];
        WRITE.lastIndex = 0;
        if (!name || !WRITE.test(part)) continue;
        writers.push(name);
        if (name in spec.exempt) continue;
        expect(/invalidateSessionVerdict|invalidateIdentityVerdict/.test(part), `${file} : ${name}() écrit une donnée du verdict sans invalider le cache`).toBe(true);
      }
      expect(writers.length).toBeGreaterThan(0);
      // Une exemption obsolète (fonction disparue) doit être retirée.
      for (const exempt of Object.keys(spec.exempt)) expect(writers, `exemption obsolète : ${exempt}`).toContain(exempt);
    });
  }
});

describe("configuration du cache (V2_SESSION_CACHE)", () => {
  it("désactivé par défaut en test et sans Redis ; activé par défaut hors test avec REDIS_URL", () => {
    expect(readVerdictCacheEnv({ REDIS_URL: "redis://x", NODE_ENV: "test" }).enabled).toBe(false);
    expect(readVerdictCacheEnv({ REDIS_URL: "redis://x", VITEST: "true" }).enabled).toBe(false);
    expect(readVerdictCacheEnv({ NODE_ENV: "production" }).enabled).toBe(false);
    expect(readVerdictCacheEnv({ REDIS_URL: "redis://x", NODE_ENV: "production" }).enabled).toBe(true);
    expect(readVerdictCacheEnv({ REDIS_URL: "redis://x" }).enabled).toBe(true);
  });

  it("`off` désactive toujours ; `on` sans Redis reste désactivé (échec fermé) ; `on` force en test", () => {
    expect(readVerdictCacheEnv({ REDIS_URL: "redis://x", NODE_ENV: "production", V2_SESSION_CACHE: "off" }).enabled).toBe(false);
    expect(readVerdictCacheEnv({ NODE_ENV: "production", V2_SESSION_CACHE: "on" }).enabled).toBe(false);
    expect(readVerdictCacheEnv({ REDIS_URL: "redis://x", NODE_ENV: "test", V2_SESSION_CACHE: "on" }).enabled).toBe(true);
  });

  it("TTL borné (1 ms à 10 s), délai Redis borné, valeur invalide refusée", () => {
    expect(readVerdictCacheEnv({ V2_SESSION_CACHE_TTL_MS: "999999" }).ttlMs).toBe(10_000);
    expect(readVerdictCacheEnv({ V2_SESSION_CACHE_TTL_MS: "0" }).ttlMs).toBe(1);
    expect(readVerdictCacheEnv({}).ttlMs).toBe(3000);
    expect(readVerdictCacheEnv({ V2_SESSION_CACHE_REDIS_TIMEOUT_MS: "1" }).redisTimeoutMs).toBe(10);
    expect(() => readVerdictCacheEnv({ V2_SESSION_CACHE_TTL_MS: "abc" })).toThrow();
  });
});
