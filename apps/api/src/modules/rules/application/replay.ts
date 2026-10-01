/**
 * Rejeu de reproductibilité (AC4.3, A-09) : prouve en continu qu'un résultat peut être reconstruit à l'identique.
 *
 *  - `replayEvaluations` : recalcule des résultats enregistrés par un consommateur
 *    `(version, hash de définition, version du moteur, inputs_hash, outputs_hash)` et compare les `outputs_hash`.
 *    Tout écart émet `rules.replay.mismatch` (outbox) et une entrée d'audit de sévérité haute ; objectif : 0 écart.
 *  - `verifyCatalogHashes` : recalcule le hash de définition de chaque version non-brouillon (nationale et de chaque
 *    établissement) ; une altération faite hors application (SQL direct) est détectée ici et à chaque chargement.
 *
 * Une version retirée reste rejouable (AC4.5).
 */
import { createSystemContext, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { computeDefinitionHash, ENGINE_VERSION } from "../domain/definition";
import { RulesCode } from "../domain/errors";
import { RulesEvents, type ReplayMismatchPayload } from "../domain/events";
import { computeInputsHash } from "../domain/evaluation";
import type { VersionKind } from "../domain/types";
import { getRules, listVersions } from "../infrastructure/catalog-repository";
import { evaluate } from "./evaluate";
import type { CompiledVersion } from "./compiled";
import type { RulesDeps } from "./deps";
import { loadVersionInTx } from "./resolve";
import type { ReplayRecord } from "./ports";
import { newEventBuffer } from "./support";

export interface ReplayMismatch {
  readonly resultId: string;
  readonly ruleVersionId: string;
  readonly ruleKey: string;
  readonly kind: "definition" | "result" | "error";
  readonly expectedHash: string;
  readonly actualHash: string;
  /** Version du moteur du résultat enregistré et du moteur courant, si elles diffèrent. */
  readonly engineVersion?: { recorded: string; current: string };
  readonly detail?: string;
}

export interface ReplayReport {
  readonly checked: number;
  readonly mismatches: readonly ReplayMismatch[];
  /** Entrées dont le contexte rejoué ne redonne plus le `inputs_hash` enregistré (la donnée source a changé). */
  readonly inputsChanged: readonly string[];
}

export async function replayEvaluations(deps: RulesDeps, ctx: RequestContext, records: readonly ReplayRecord[]): Promise<Result<ReplayReport, AppError>> {
  const mismatches: ReplayMismatch[] = [];
  const inputsChanged: string[] = [];
  const versions = new Map<string, Result<CompiledVersion, AppError>>();

  for (const record of records) {
    let loaded = versions.get(record.ruleVersionId);
    if (!loaded) {
      loaded = await deps.db.run(ctx, (tx) => loadVersionInTx(deps, tx, record.ruleVersionId, { verify: true }), { readOnly: true });
      versions.set(record.ruleVersionId, loaded);
    }
    if (!loaded.ok) {
      mismatches.push({
        resultId: record.resultId,
        ruleVersionId: record.ruleVersionId,
        ruleKey: record.ruleKey,
        kind: loaded.error.code === RulesCode.HASH_MISMATCH ? "definition" : "error",
        expectedHash: record.definitionHash,
        actualHash: String((loaded.error.details as { actualHash?: string } | undefined)?.actualHash ?? "indisponible"),
        detail: loaded.error.message,
      });
      continue;
    }
    const compiled = loaded.value;
    if (compiled.definitionHash !== record.definitionHash) {
      mismatches.push({
        resultId: record.resultId,
        ruleVersionId: record.ruleVersionId,
        ruleKey: record.ruleKey,
        kind: "definition",
        expectedHash: record.definitionHash,
        actualHash: compiled.definitionHash,
      });
      continue;
    }
    const entry = compiled.rule(record.ruleKey);
    if (entry.ok) {
      const inputsHash = computeInputsHash(record.ruleKey, entry.value.inputSchema, record.context, record.overrides ?? {});
      if (inputsHash !== record.inputsHash) inputsChanged.push(record.resultId);
    }
    const result = evaluate(compiled, { ruleKey: record.ruleKey, context: record.context, overrides: record.overrides, trace: false });
    if (!result.ok) {
      mismatches.push({
        resultId: record.resultId,
        ruleVersionId: record.ruleVersionId,
        ruleKey: record.ruleKey,
        kind: "error",
        expectedHash: record.outputsHash,
        actualHash: `error:${result.error.code}`,
        detail: result.error.message,
      });
    } else if (result.value.outputsHash !== record.outputsHash) {
      mismatches.push({
        resultId: record.resultId,
        ruleVersionId: record.ruleVersionId,
        ruleKey: record.ruleKey,
        kind: "result",
        expectedHash: record.outputsHash,
        actualHash: result.value.outputsHash,
        ...(record.engineVersion !== ENGINE_VERSION ? { engineVersion: { recorded: record.engineVersion, current: ENGINE_VERSION } } : {}),
      });
    }
  }

  if (mismatches.length > 0) await publishMismatches(deps, ctx, mismatches);
  return ok({ checked: records.length, mismatches, inputsChanged });
}

async function publishMismatches(deps: RulesDeps, ctx: RequestContext, mismatches: readonly ReplayMismatch[]): Promise<void> {
  await deps.db.run(ctx, async (tx) => {
    const events = newEventBuffer(deps, ctx);
    for (const m of mismatches) {
      const payload: ReplayMismatchPayload = {
        v: 1,
        kind: m.kind === "definition" ? "definition" : "result",
        resultId: m.resultId,
        ruleVersionId: m.ruleVersionId,
        ruleKey: m.ruleKey,
        expectedHash: m.expectedHash,
        actualHash: m.actualHash,
      };
      events.add(RulesEvents.REPLAY_MISMATCH, payload as unknown as { v: 1 } & Record<string, unknown>, { type: "rule_version", id: m.ruleVersionId });
    }
    await events.flush(tx);
    await deps.audit.record(tx, {
      action: "rules.replay.mismatch",
      entity: "rule_version",
      entityId: mismatches[0]?.ruleVersionId ?? null,
      severity: "critical",
      metadata: { count: mismatches.length, kinds: [...new Set(mismatches.map((m) => m.kind))], resultIds: mismatches.slice(0, 50).map((m) => m.resultId) },
    });
  });
}

/* ------------------------------ intégrité du catalogue ------------------------------ */

export interface HashIssue {
  readonly kind: VersionKind;
  readonly tenantId: string | null;
  readonly versionId: string;
  readonly ruleSetCode: string;
  readonly versionNo: number;
  readonly expectedHash: string | null;
  readonly actualHash: string;
}

async function hashIssuesOf(tx: Parameters<typeof listVersions>[0], kind: VersionKind, tenantId: string | null): Promise<HashIssue[]> {
  const issues: HashIssue[] = [];
  for (const version of await listVersions(tx, kind, {})) {
    if (version.status === "draft" || version.status === "simulated") continue;
    const actual = computeDefinitionHash(version.contractId, await getRules(tx, kind, version.id));
    if (version.definitionHash !== actual) {
      issues.push({ kind, tenantId, versionId: version.id, ruleSetCode: version.ruleSetCode, versionNo: version.versionNo, expectedHash: version.definitionHash, actualHash: actual });
    }
  }
  return issues;
}

/** Vérifie le hash de toutes les versions figées (catalogue national, puis chaque établissement actif). */
export async function verifyCatalogHashes(deps: RulesDeps): Promise<HashIssue[]> {
  const issues = await deps.systemDb.run("rules-verify-catalog-national", (tx) => hashIssuesOf(tx, "NATIONAL", null), { readOnly: true });
  const report = await deps.systemDb.forEachTenant("rules-verify-catalog-tenants", (tx, tenant) => hashIssuesOf(tx, "TENANT", tenant.id));
  for (const s of report.succeeded) issues.push(...s.result);
  for (const f of report.failed) deps.logger.error({ tenantId: f.tenantId }, "rules : vérification du catalogue en échec pour ce tenant");

  // Signalement : événement outbox dans le tenant concerné ; le national est journalisé (et audité par le job).
  for (const issue of issues) {
    deps.logger.error({ ...issue }, "rules : empreinte de définition divergente (altération hors application ?)");
    if (issue.kind === "TENANT" && issue.tenantId) {
      await deps.systemDb.runForTenant("rules-verify-catalog-signal", issue.tenantId, async (tx) => {
        const ctx = createSystemContext(issue.tenantId as string);
        const events = newEventBuffer(deps, ctx);
        const payload: ReplayMismatchPayload = {
          v: 1,
          kind: "definition",
          resultId: issue.versionId,
          ruleVersionId: issue.versionId,
          expectedHash: issue.expectedHash ?? "",
          actualHash: issue.actualHash,
        };
        events.add(RulesEvents.REPLAY_MISMATCH, payload as unknown as { v: 1 } & Record<string, unknown>, { type: "rule_version", id: issue.versionId });
        await events.flush(tx);
      });
    }
  }
  return issues;
}

/** Rejeu d'un échantillon fourni par les sources branchées (une par contrat), pour UN tenant. */
export async function replaySampleForTenant(deps: RulesDeps, ctx: RequestContext, percent: number): Promise<Result<ReplayReport, AppError>> {
  const all: ReplayRecord[] = [];
  for (const source of deps.replaySources.values()) all.push(...(await source.sample({ ctx, percent })));
  return replayEvaluations(deps, ctx, all);
}

