/**
 * Création anticipée des partitions (journal d'audit append-only, partitionné par mois).
 *
 * Le module `audit` expose `audit.ensure_partitions(p_months_ahead integer DEFAULT 3, p_months_back integer DEFAULT 0)`
 * (nom configurable : `AUDIT_ENSURE_PARTITIONS_FN`). Ce job l'appelle chaque nuit avec
 * `AUDIT_PARTITIONS_MONTHS_AHEAD` mois d'avance. Tant que le module n'est pas déployé, ou si EXECUTE
 * n'est pas accordé à app_user, le job est un NO-OP journalisé (jamais une erreur).
 *
 * Signatures acceptées : appelables avec 0 ou 1 argument, dont le premier est un entier (mois d'avance).
 * Toute autre signature est signalée et ignorée. La fonction doit être idempotente.
 */
import { defineScheduledJob } from "../sdk";

export interface EnsurePartitionsOptions {
  /** `schema.fonction`, déjà validé par la configuration. */
  functionName: string;
  monthsAhead: number;
  cron?: string;
}

interface ProcRow {
  pronargs: number;
  pronargdefaults: number;
  argtypes: string;
  signature: string;
  can_exec: boolean;
}

/** OID des types entiers : int2, int4, int8. */
const INT_TYPES = new Set(["21", "23", "20"]);

export function ensurePartitionsJob(options: EnsurePartitionsOptions) {
  const [schema, fn] = options.functionName.split(".") as [string, string];
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || !/^[a-z_][a-z0-9_]*$/.test(fn)) {
    throw new Error(`ensure-partitions : nom de fonction invalide "${options.functionName}".`);
  }

  return defineScheduledJob({
    name: "ensure-partitions",
    cron: options.cron ?? "5 2 * * *",
    handler: async ({ systemDb, logger }) => {
      const procs = await systemDb.run(
        "ensure-partitions :: sonde",
        (tx) =>
          tx.many<ProcRow>(
            `SELECT p.pronargs::int AS pronargs, p.pronargdefaults::int AS pronargdefaults,
                    p.proargtypes::text AS argtypes,
                    pg_get_function_identity_arguments(p.oid) AS signature,
                    has_function_privilege(current_user, p.oid, 'EXECUTE') AS can_exec
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = 'f'`,
            [schema, fn],
          ),
        { readOnly: true },
      );

      if (procs.length === 0) {
        logger.info({ fn: options.functionName }, "ensure-partitions : fonction absente (module audit non déployé), rien à faire");
        return;
      }

      // Appelable avec 0 argument, ou avec 1 argument entier (les suivants ayant une valeur par défaut).
      const callable = procs
        .filter((p) => p.can_exec)
        .map((p) => {
          const required = p.pronargs - p.pronargdefaults;
          const first = p.argtypes.trim().split(/\s+/)[0] ?? "";
          if (p.pronargs === 0) return { p, withMonths: false, score: 0 };
          if (required <= 1 && INT_TYPES.has(first)) return { p, withMonths: true, score: 1 };
          return null;
        })
        .filter((c): c is { p: ProcRow; withMonths: boolean; score: number } => c !== null)
        .sort((a, b) => a.score - b.score);
      const chosen = callable[0];
      if (!chosen) {
        logger.warn(
          { fn: options.functionName, signatures: procs.map((p) => ({ args: p.signature, canExecute: p.can_exec })) },
          "ensure-partitions : aucune signature utilisable (attendu () ou (integer, ...) avec EXECUTE accordé à app_user) : ignoré",
        );
        return;
      }

      const call = chosen.withMonths ? `SELECT * FROM "${schema}"."${fn}"($1)` : `SELECT * FROM "${schema}"."${fn}"()`;
      const rows = await systemDb.run("ensure-partitions :: création des partitions", (tx) =>
        tx.many(call, chosen.withMonths ? [options.monthsAhead] : []),
      );
      logger.info(
        { fn: options.functionName, monthsAhead: options.monthsAhead, created: rows.length, result: JSON.stringify(rows).slice(0, 500) },
        "partitions vérifiées",
      );
    },
  });
}
