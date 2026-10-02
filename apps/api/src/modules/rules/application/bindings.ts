/**
 * Liaisons : quel jeu de règles pour quel périmètre (contrat × établissement / niveau / nœud × dates).
 * Sans liaison applicable, `resolve` renvoie `null` et le calcul est refusé (`results.no_active_ruleset`) : il n'existe
 * AUCUNE valeur par défaut codée. Changer une liaison n'altère jamais un résultat existant (épinglage par période).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isValidIsoDate } from "../engine";
import { getContract } from "../contracts";
import { RulesCode, conflict, notFound, validation } from "../domain/errors";
import { RulesEvents, type BindingChangedPayload } from "../domain/events";
import type { BindingRecord, RuleVersionRecord } from "../domain/types";
import { deleteBinding as deleteBindingRow, findBindingByIdentity, getBinding, insertBinding, listBindings, updateBinding } from "../infrastructure/bindings-repository";
import { getRuleSetByCode, listVersions } from "../infrastructure/catalog-repository";
import { isExclusionViolation } from "../infrastructure/pg";
import { inTx, type RulesDeps } from "./deps";
import { newEventBuffer, recordAudit } from "./support";

export interface BindingInput {
  readonly contractId: string;
  readonly ruleSetCode: string;
  readonly institutionId?: string | null | undefined;
  readonly curriculumNodeId?: string | null | undefined;
  readonly levelCode?: string | null | undefined;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null | undefined;
  /**
   * Accusé EXPLICITE de l'usage d'un jeu de règles FICTIF (`placeholder`) : exigé en production (`rules.placeholder_requires_ack`).
   * L'appelant HTTP vérifie la permission sensible `rules.binding.accept_placeholder` avant de le transmettre.
   */
  readonly placeholderAck?: { readonly reason: string } | undefined;
}

export async function listTenantBindings(deps: RulesDeps, ctx: RequestContext, contractId?: string): Promise<Result<BindingRecord[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listBindings(tx, contractId ? { contractId } : {})), { readOnly: true });
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["approved", "published"]);

/** Version fictive (jeu de démonstration) actuellement applicable : jamais un brouillon ni une version retirée. */
function isActivePlaceholder(v: RuleVersionRecord): boolean {
  return v.source.kind === "placeholder" && ACTIVE_STATUSES.has(v.status);
}

/** La période d'effet de la version recoupe-t-elle celle de la liaison (bornes incluses, « AAAA-MM-JJ ») ? */
function overlaps(v: RuleVersionRecord, from: string, to: string | null): boolean {
  return v.effectiveFrom <= (to ?? "9999-12-31") && (v.effectiveTo ?? "9999-12-31") >= from;
}

function payloadOf(b: BindingRecord, change: BindingChangedPayload["change"]): BindingChangedPayload {
  return {
    v: 1,
    bindingId: b.id,
    contractId: b.contractId,
    ruleSetCode: b.ruleSetCode,
    scope: { institutionId: b.institutionId, curriculumNodeId: b.curriculumNodeId, levelCode: b.levelCode },
    effectiveFrom: b.effectiveFrom,
    effectiveTo: b.effectiveTo,
    change,
    placeholderAcknowledged: b.placeholderAck != null,
  };
}

/** Crée la liaison, ou met à jour celle de même identité (contrat, périmètre exact, début d'effet). */
export async function putBinding(deps: RulesDeps, ctx: RequestContext, input: BindingInput): Promise<Result<BindingRecord, AppError>> {
  if (!getContract(input.contractId)) return err(validation(RulesCode.UNKNOWN_CONTRACT, `Contrat inconnu : ${input.contractId}.`, "contractId"));
  if (!isValidIsoDate(input.effectiveFrom) || (input.effectiveTo != null && !isValidIsoDate(input.effectiveTo))) {
    return err(validation(RulesCode.INVALID_INPUT, "Date d'effet invalide (format attendu : AAAA-MM-JJ).", "effectiveFrom"));
  }
  if (input.effectiveTo != null && input.effectiveTo < input.effectiveFrom) {
    return err(validation(RulesCode.INVALID_INPUT, "La fin d'effet doit être postérieure ou égale au début.", "effectiveTo"));
  }
  if (input.curriculumNodeId && input.levelCode) {
    return err(validation(RulesCode.INVALID_INPUT, "Une liaison cible un nœud de curriculum OU un niveau, pas les deux.", "levelCode"));
  }
  const scope = {
    institutionId: input.institutionId ?? null,
    curriculumNodeId: input.curriculumNodeId ?? null,
    levelCode: input.levelCode ?? null,
  };
  return inTx(deps, ctx, async (tx) => {
    // Le jeu doit exister (national, ou variante du tenant) et porter une version du contrat demandé.
    const national = await getRuleSetByCode(tx, "NATIONAL", input.ruleSetCode);
    const own = await getRuleSetByCode(tx, "TENANT", input.ruleSetCode);
    if (!national && !own) return err(notFound(RulesCode.RULESET_NOT_FOUND, "Jeu de règles", input.ruleSetCode));
    const candidates = [
      ...(national ? await listVersions(tx, "NATIONAL", { ruleSetId: national.id, contractId: input.contractId, statuses: ["published", "retired"] }) : []),
      ...(own ? await listVersions(tx, "TENANT", { ruleSetId: own.id, contractId: input.contractId }) : []),
    ];
    if (candidates.length === 0) {
      return err(validation(RulesCode.CONTRACT_VIOLATION, `Le jeu « ${input.ruleSetCode} » n'a aucune version pour le contrat ${input.contractId}.`, "ruleSetCode"));
    }

    // Jeu FICTIF : une version active et fictive sur la période de la liaison exige un accusé explicite en production.
    const placeholder = candidates.filter((v) => isActivePlaceholder(v) && overlaps(v, input.effectiveFrom, input.effectiveTo ?? null));
    const ackReason = input.placeholderAck?.reason.trim() ?? "";
    if (placeholder.length > 0 && deps.config.productionMode && ackReason.length === 0) {
      return err(
        validation(
          RulesCode.PLACEHOLDER_REQUIRES_ACK,
          `Le jeu « ${input.ruleSetCode} » est un jeu de DÉMONSTRATION (fictif, aucune valeur officielle) : sa liaison en production exige un accusé explicite.`,
          "placeholderAck",
          { ruleSetCode: input.ruleSetCode, contractId: input.contractId },
        ),
      );
    }
    if (placeholder.length > 0 && ackReason.length > 0 && (ackReason.length < 10 || !ctx.userId)) {
      return err(validation(RulesCode.PLACEHOLDER_REQUIRES_ACK, "L'accusé doit être motivé (10 caractères au moins) et porté par un utilisateur identifié.", "placeholderAck"));
    }
    const placeholderAck = placeholder.length > 0 && ackReason.length > 0 ? { by: ctx.userId as string, at: deps.clock.now(), reason: ackReason } : null;

    const existing = await findBindingByIdentity(tx, { contractId: input.contractId, ...scope, effectiveFrom: input.effectiveFrom });
    const events = newEventBuffer(deps, ctx);
    let binding: BindingRecord;
    try {
      binding = existing
        ? await updateBinding(tx, existing.id, { ruleSetCode: input.ruleSetCode, effectiveTo: input.effectiveTo ?? null, placeholderAck })
        : await insertBinding(tx, ctx.tenantId, {
            id: deps.newId(),
            contractId: input.contractId,
            ruleSetCode: input.ruleSetCode,
            ...scope,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo ?? null,
            createdBy: ctx.userId,
            placeholderAck,
          });
    } catch (e) {
      if (isExclusionViolation(e)) {
        return err(conflict(RulesCode.OVERLAP, "Une liaison du même périmètre couvre déjà tout ou partie de cette période.", { contractId: input.contractId, ...scope }));
      }
      throw e;
    }
    const change = existing ? "updated" : "created";
    events.add(RulesEvents.BINDING_CHANGED, payloadOf(binding, change) as unknown as { v: 1 } & Record<string, unknown>, { type: "rule_binding", id: binding.id });
    await events.flush(tx);
    await recordAudit(
      deps,
      tx,
      { kind: "TENANT", tenantId: ctx.tenantId, ctx, actor: { kind: "tenant_admin", id: ctx.userId, name: ctx.userId ?? "inconnu" } },
      {
        action: `rules.binding.${change}`,
        entity: "rule_binding",
        entityId: binding.id,
        before: existing ? { ruleSetCode: existing.ruleSetCode, effectiveTo: existing.effectiveTo } : undefined,
        after: { contractId: binding.contractId, ruleSetCode: binding.ruleSetCode, ...scope, effectiveFrom: binding.effectiveFrom, effectiveTo: binding.effectiveTo },
        severity: "notice",
      },
    );
    if (placeholderAck) {
      // Acte sensible : un jeu de démonstration (aucune valeur officielle) devient la règle appliquée aux résultats.
      await recordAudit(
        deps,
        tx,
        { kind: "TENANT", tenantId: ctx.tenantId, ctx, actor: { kind: "tenant_admin", id: ctx.userId, name: ctx.userId ?? "inconnu" } },
        {
          action: "rules.binding.placeholder_acknowledged",
          entity: "rule_binding",
          entityId: binding.id,
          after: { contractId: binding.contractId, ruleSetCode: binding.ruleSetCode, ...scope, effectiveFrom: binding.effectiveFrom },
          reason: placeholderAck.reason,
          metadata: { productionMode: deps.config.productionMode, versions: placeholder.map((v) => `${v.ruleSetCode} v${v.versionNo}`) },
          severity: "warning",
        },
      );
    }
    return ok(binding);
  });
}

export async function removeBinding(deps: RulesDeps, ctx: RequestContext, bindingId: string): Promise<Result<void, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const binding = await getBinding(tx, bindingId, { forUpdate: true });
    if (!binding) return err(notFound(RulesCode.BINDING_NOT_FOUND, "Liaison", bindingId));
    await deleteBindingRow(tx, bindingId);
    const events = newEventBuffer(deps, ctx);
    events.add(RulesEvents.BINDING_CHANGED, payloadOf(binding, "deleted") as unknown as { v: 1 } & Record<string, unknown>, { type: "rule_binding", id: binding.id });
    await events.flush(tx);
    await recordAudit(
      deps,
      tx,
      { kind: "TENANT", tenantId: ctx.tenantId, ctx, actor: { kind: "tenant_admin", id: ctx.userId, name: ctx.userId ?? "inconnu" } },
      {
        action: "rules.binding.deleted",
        entity: "rule_binding",
        entityId: binding.id,
        before: { contractId: binding.contractId, ruleSetCode: binding.ruleSetCode, effectiveFrom: binding.effectiveFrom, effectiveTo: binding.effectiveTo },
        severity: "notice",
      },
    );
    return ok(undefined);
  });
}
