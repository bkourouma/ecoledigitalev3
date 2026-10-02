/**
 * Travaux planifiés de la vie scolaire (spec 006 §11), exécutés par `apps/worker` sous un contexte SYSTÈME.
 *
 *  - `schoollife.remind-convocations` (horaire) : rappelle aux tuteurs une convocation ENVOYÉE dont l'échéance tombe dans la
 *    fenêtre `convocation_reminder_hours` de l'établissement. Réglage VIDE par défaut = aucun rappel (rien n'est présumé).
 *  - `schoollife.exclusion-boundaries` (quotidien) : avis NEUTRE aux tuteurs au début et à la fin d'une exclusion temporaire
 *    en vigueur, si l'établissement l'a activé (`exclusion_boundary_notices`, éteint par défaut). Le texte est celui de l'avis de
 *    mesure (jamais la nature, la gravité ni le motif).
 *
 * Ce que ces jobs NE FONT PAS : ils ne décident rien (ni validation, ni mesure, ni changement de statut d'élève : les effets
 * d'une exclusion restent `AWAITING_HUMAN`) et ne qualifient PAS les absences d'une période d'exclusion (question métier Q6-19
 * ouverte : aucune règle n'est codée ici).
 *
 * Garanties : IDEMPOTENTS (registre `job_notifications`, clé unique (genre, sujet, occurrence) ; clé d'idempotence de l'envoi =
 * identifiant de la ligne, donc un rejeu après plantage ne double pas la remise), plusieurs instances sans doublon (une ligne
 * `PENDING` récente n'est pas reprise), tentatives bornées, un échec sur un sujet n'arrête pas les autres ni les autres tenants.
 * L'envoi passe par le port `notifications` (mise en file ; consentements et canaux appliqués) : jamais de simulation, jamais
 * d'effet externe dans une transaction du module.
 */
import { abidjanDateTime, createSystemContext, ok, type RequestContext } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import * as jobs from "../infrastructure/jobs-repository";
import { inTx, todayOf, type SchoolLifeDeps } from "./deps";
import { studentNames } from "./support";

const BATCH = 200;
const CHANNELS = ["IN_APP", "EMAIL"] as const;

export interface JobReport {
  readonly examined: number;
  readonly sent: number;
  readonly failed: number;
}

const empty = (): { examined: number; sent: number; failed: number } => ({ examined: 0, sent: 0, failed: 0 });

/** Code court et sûr tiré d'une erreur (jamais un message amont : il pourrait contenir une coordonnée). */
function codeOf(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : "notification_failed";
}

async function deliver(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  claim: { kind: jobs.JobNotificationKind; subjectId: string; occurrence: string },
  send: (clientKey: string) => Promise<void>,
  report: { examined: number; sent: number; failed: number },
): Promise<void> {
  report.examined += 1;
  const claimed = await inTx(deps, ctx, async (tx) => ok(await jobs.claimJobNotification(tx, { id: deps.newId(), tenantId: ctx.tenantId, ...claim })));
  if (!claimed.ok || !claimed.value) return; // déjà envoyé, pris par une autre instance, ou tentatives épuisées
  let outcome: { status: "SENT" | "FAILED"; errorCode?: string };
  try {
    await send(claimed.value.id);
    outcome = { status: "SENT" };
  } catch (e) {
    outcome = { status: "FAILED", errorCode: codeOf(e) };
    deps.logger.warn({ kind: claim.kind, subjectId: claim.subjectId, code: outcome.errorCode, attempts: claimed.value.attempts }, "schoollife : envoi automatique en échec");
  }
  await inTx(deps, ctx, async (tx) => {
    await jobs.finishJobNotification(tx, claimed.value!.id, outcome);
    return ok(true);
  });
  if (outcome.status === "SENT") report.sent += 1;
  else report.failed += 1;
}

/** Rappel des convocations envoyées dont l'échéance approche. */
export async function remindConvocations(deps: SchoolLifeDeps, ctx: RequestContext): Promise<JobReport> {
  const due = await inTx(deps, ctx, async (tx) => ok(await jobs.listConvocationsToRemind(tx, deps.clock.now(), BATCH)), { readOnly: true });
  if (!due.ok) throw due.error;
  const report = empty();
  for (const c of due.value) {
    await deliver(
      deps,
      ctx,
      { kind: "CONVOCATION_REMINDER", subjectId: c.id, occurrence: c.scheduledAt.toISOString().slice(0, 19) + "Z" },
      async (clientKey) => {
        const names = await studentNames(deps, ctx, [c.studentId]);
        const when = abidjanDateTime(c.scheduledAt);
        await deps.ports.notifications.notifyGuardians(ctx, {
          kind: "CONVOCATION",
          studentId: c.studentId,
          guardianIds: c.guardianIds,
          channels: CHANNELS,
          variables: { subject: "Rappel de convocation", date: when.slice(0, 10), time: when.slice(11, 16), place: c.location ?? "À préciser", studentName: names.get(c.studentId) ?? "votre enfant" },
          clientKey,
        });
      },
      report,
    );
  }
  return report;
}

/** Avis de début et de fin des exclusions temporaires en vigueur. */
export async function notifyExclusionBoundaries(deps: SchoolLifeDeps, ctx: RequestContext): Promise<JobReport> {
  const today = todayOf(deps);
  const report = empty();
  for (const kind of ["EXCLUSION_STARTED", "EXCLUSION_ENDED"] as const) {
    const due = await inTx(deps, ctx, async (tx) => ok(await jobs.listExclusionsAtBoundary(tx, today, kind, BATCH)), { readOnly: true });
    if (!due.ok) throw due.error;
    for (const m of due.value) {
      await deliver(
        deps,
        ctx,
        { kind, subjectId: m.id, occurrence: kind === "EXCLUSION_STARTED" ? m.startsOn : m.endsOn },
        async (clientKey) => {
          const guardians = await deps.ports.people.listGuardiansOfStudent(ctx, m.studentId);
          if (guardians.length === 0) throw Object.assign(new Error("Aucun tuteur lié."), { code: "schoollife.no_guardians" });
          const names = await studentNames(deps, ctx, [m.studentId]);
          await deps.ports.notifications.notifyGuardians(ctx, {
            kind: "MEASURE_NOTICE",
            studentId: m.studentId,
            guardianIds: guardians.map((g) => g.guardianId),
            channels: CHANNELS,
            variables: { studentName: names.get(m.studentId) ?? "votre enfant" },
            clientKey,
          });
        },
        report,
      );
    }
  }
  return report;
}

export const remindConvocationsAllTenants = (deps: SchoolLifeDeps, systemDb: SystemDb): Promise<ForEachTenantReport<JobReport>> =>
  systemDb.forEachTenant("schoollife-remind-convocations", async (_tx, tenant) => remindConvocations(deps, createSystemContext(tenant.id)));

export const notifyExclusionBoundariesAllTenants = (deps: SchoolLifeDeps, systemDb: SystemDb): Promise<ForEachTenantReport<JobReport>> =>
  systemDb.forEachTenant("schoollife-exclusion-boundaries", async (_tx, tenant) => notifyExclusionBoundaries(deps, createSystemContext(tenant.id)));
