/**
 * Frontières du modular monolith (ADR-001, ADR-002, conventions des modules).
 *
 *   pnpm check:boundaries
 *
 * Toutes les règles de niveau `error` bloquent la CI (job `boundaries`).
 * Les chemins sont relatifs à la racine du dépôt (répertoire courant de depcruise).
 *
 * Règles
 *  - modules-only-via-index        un module n'importe d'un autre module que son index.ts ;
 *  - platform-adapters-*          platform/adapters/ = seul endroit qui connaît plusieurs modules, par leurs index.ts uniquement
 *                                  (ni legacy, ni pg) ; un module n'importe jamais platform/adapters/ ;
 *  - domain-is-pure                domain/ n'importe ni pg, ni fastify, ni database, ni infrastructure,
 *                                  application, http, ni platform ;
 *  - application-no-http           application/ n'importe ni http/ ni fastify ;
 *  - no-pg-outside-infrastructure  `pg` uniquement dans infrastructure/ (et les tests) ;
 *  - no-legacy-in-modules          aucun module v2 n'importe le code legacy (routes, services,
 *                                  middleware(s), plugins, jobs, utils…) — seul platform/ est permis ;
 *  - no-prisma-in-modules          Prisma disparaît avec le reset de la base (ADR-006) ;
 *  - kernel-pure / rules-engine-pure / database-no-app   les packages restent purs ;
 *  - packages-no-apps              un package n'importe jamais une app.
 *
 * Non couverts ici (revue de code) : les constantes de seuil académique dans modules/**
 * (elles appartiennent à un RuleSet du rules-engine, conventions n°11).
 */
/** `pg` et Fastify, qu'ils soient résolus (node_modules) ou non résolus (nom nu). */
const PG = "(^|/)node_modules/pg(/|$)|^pg(/|$)";
const FASTIFY = "(^|/)node_modules/(fastify|fastify-plugin|@fastify/[^/]+)(/|$)|^(fastify|fastify-plugin|@fastify/[^/]+)(/|$)";
const NODE_IO = "^(node:)?(fs|fs/promises|child_process|net|http|https|dns|worker_threads)$";

const TESTS = "(^|/)(test|tests|__tests__)/|\\.(test|spec)\\.[cm]?[jt]sx?$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "modules-only-via-index",
      severity: "error",
      comment:
        "Un module n'importe d'un autre module que son index.ts (ADR-001). Passez par l'API publique ou par les événements.",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api/src/modules/([^/]+)/",
        pathNot: ["^apps/api/src/modules/$1/", "^apps/api/src/modules/[^/]+/index\\.(ts|js)$"],
      },
    },
    {
      name: "modules-root-only-via-index",
      severity: "error",
      comment:
        "Les fichiers à la racine de modules/ (registre, listes blanches d'isolation) n'importent des modules que leur index.ts.",
      from: { path: "^apps/api/src/modules/[^/]+\\.(ts|js)$" },
      to: {
        path: "^apps/api/src/modules/[^/]+/",
        pathNot: "^apps/api/src/modules/[^/]+/index\\.(ts|js)$",
      },
    },
    {
      name: "platform-adapters-only-via-index",
      severity: "error",
      comment:
        "apps/api/src/platform/adapters/ est le SEUL endroit qui connaît plusieurs modules (adaptateurs de ports entre modules). " +
        "Il importe uniquement leurs index.ts (API publique) : aucune autre exception, aucun accès aux fichiers internes d'un module.",
      from: { path: "^apps/api/src/platform/adapters/" },
      to: {
        path: "^apps/api/src/modules/",
        pathNot: ["^apps/api/src/modules/[^/]+/index\\.(ts|js)$", "^apps/api/src/modules/registry-discovery\\.(ts|js)$"],
      },
    },
    {
      name: "platform-adapters-no-legacy-no-pg",
      severity: "error",
      comment:
        "Les adaptateurs de plateforme ne touchent ni le code legacy (routes, services, middleware…) ni `pg` : ils appellent l'API publique des modules (qui passe par TenantDb).",
      from: { path: "^apps/api/src/platform/adapters/", pathNot: TESTS },
      to: { path: [PG, "^apps/api/src/(?!(modules|platform)/)"] },
    },
    {
      name: "modules-not-adapters",
      severity: "error",
      comment:
        "Un module n'importe jamais platform/adapters/ : ce sont les adaptateurs qui dépendent des modules, jamais l'inverse (sinon le découplage par ports est perdu).",
      from: { path: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/platform/adapters/" },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "domain/ = règles pures : aucun import de pg, fastify, @ecoledigitale/database, infrastructure, application, http ni platform.",
      from: { path: "^apps/api/src/modules/[^/]+/domain/" },
      to: {
        path: [
          PG,
          FASTIFY,
          "(^|/)packages/database/",
          "^@ecoledigitale/database(/|$)",
          "^apps/api/src/modules/[^/]+/(infrastructure|application|http)/",
          "^apps/api/src/platform/",
        ],
      },
    },
    {
      name: "application-no-http",
      severity: "error",
      comment: "application/ ne dépend ni de la couche HTTP du module ni de Fastify.",
      from: { path: "^apps/api/src/modules/[^/]+/application/", pathNot: TESTS },
      to: { path: ["^apps/api/src/modules/[^/]+/http/", FASTIFY] },
    },
    {
      name: "no-pg-outside-infrastructure",
      severity: "error",
      comment:
        "Pas de `pg` hors de infrastructure/ (ADR-001). L'accès aux données passe par TenantDb/SystemDb (ADR-002), jamais par un pool direct.",
      from: { path: "^apps/api/src/modules/", pathNot: ["^apps/api/src/modules/[^/]+/infrastructure/", TESTS] },
      to: { path: PG },
    },
    {
      name: "no-legacy-in-modules",
      severity: "error",
      comment:
        "Aucun module v2 n'importe le code legacy d'apps/api/src (routes, services, middleware(s), plugins, jobs, utils, config…). Seul platform/ est autorisé.",
      from: { path: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/(?!(modules|platform)/)" },
    },
    {
      name: "no-prisma-in-modules",
      severity: "error",
      comment: "Prisma est conservé jusqu'au reset de la base (ADR-006) mais n'a pas sa place dans les modules v2.",
      from: { path: "^apps/api/src/modules/" },
      to: { path: ["(^|/)node_modules/(@prisma|\\.prisma)/", "^@prisma/", "^apps/api/prisma/"] },
    },
    {
      name: "rules-engine-only-in-rules-module",
      severity: "error",
      comment:
        "Seul le module `rules` importe @ecoledigitale/rules-engine (spec 012, A-01) : `results`, `higher` et `reportcards` passent par " +
        "modules/rules/index.ts (résolution, cache, journal d'erreurs, épinglage). Vaut pour le nom du paquet ET pour son chemin dans le dépôt.",
      from: { path: "^(apps|packages)/", pathNot: ["^apps/api/src/modules/rules/", "^packages/rules-engine/"] },
      to: { path: ["^packages/rules-engine/", "^@ecoledigitale/rules-engine(/|$)", "(^|/)node_modules/@ecoledigitale/rules-engine/"] },
    },
    {
      name: "kernel-pure",
      severity: "error",
      comment: "@ecoledigitale/kernel est pur : ni pg, ni fastify, ni autre package du monorepo, ni code d'app.",
      from: { path: "^packages/kernel/src/" },
      to: {
        path: [PG, FASTIFY, "^packages/(database|rules-engine|contracts)/", "^apps/"],
      },
    },
    {
      name: "rules-engine-pure",
      severity: "error",
      comment: "packages/rules-engine n'importe ni pg, ni Fastify, ni node:fs / E/S réseau (ADR-001, ADR-003).",
      from: { path: "^packages/rules-engine/src/" },
      to: {
        path: [PG, FASTIFY, "^apps/"],
      },
    },
    {
      name: "rules-engine-no-node-io",
      severity: "error",
      comment: "rules-engine : pas d'E/S Node (fs, réseau, processus).",
      from: { path: "^packages/rules-engine/src/" },
      to: { dependencyTypes: ["core"], path: NODE_IO },
    },
    {
      name: "database-no-app",
      severity: "error",
      comment: "@ecoledigitale/database ne dépend d'aucune app ni d'aucun module.",
      from: { path: "^packages/database/src/" },
      to: { path: "^apps/" },
    },
    {
      name: "packages-no-apps",
      severity: "error",
      comment: "Un package partagé n'importe jamais une app.",
      from: { path: "^packages/[^/]+/src/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-circular-in-modules",
      severity: "warn",
      comment: "Cycle d'imports dans les modules v2 (avertissement : à résoudre).",
      from: { path: "^apps/api/src/(modules|platform)/" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // node_modules n'est PAS exclu (les règles pg/fastify en ont besoin) : il est seulement non suivi (doNotFollow).
    exclude: { path: ["\\.d\\.ts$"] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["main", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
