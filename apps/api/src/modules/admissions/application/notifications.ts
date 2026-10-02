/**
 * Notifications aux familles (US12) : chaque envoi est une ligne IDEMPOTENTE de `notification_log` (clé de dédoublonnage),
 * écrite DANS la transaction du changement qui la provoque ; l'envoi lui-même a lieu APRÈS le commit (jamais d'effet externe
 * dans une transaction) et son résultat met la ligne à jour. Sans canal : `SKIPPED` / `CHANNEL_UNAVAILABLE` — AUCUNE simulation
 * d'envoi (plan §3.11). L'adresse du destinataire n'est jamais stockée : elle est résolue à l'envoi depuis le tuteur.
 */
import type { Tx } from "@ecoledigitale/database";
import type { RequestContext } from "@ecoledigitale/kernel";
import { hmacHex } from "../domain/tokens";
import * as cases from "../infrastructure/case-repository";
import type { AdmissionsDeps, TxScope } from "./deps";
import type { ApplicantMessage } from "./ports";

export type Delivery = "SENT" | "QUEUED" | "SKIPPED" | "FAILED";

export interface Recipient {
  readonly id: string;
  readonly firstName: string;
  readonly email: string | null;
  readonly phone: string | null;
}

export interface NotifyInput {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly recipient: Recipient;
  readonly templateCode: string;
  /** Clé d'idempotence de CET envoi (une transition, une offre…). */
  readonly dedupeKey: string;
  readonly data?: Readonly<Record<string, string | readonly string[]>>;
  /** Limite « une confirmation par contact et par jour » (anti-relais de spam du formulaire public). */
  readonly oncePerContactPerDay?: boolean;
}

export interface NotifyHandle {
  /** Résultat de l'envoi ; connu une fois la transaction validée (les effets post-commit sont terminés au retour du cas d'usage). */
  readonly status: () => Delivery;
}

const ERR_CHANNEL = "admissions.channel_unavailable";

/** Enregistre la ligne (dans `tx`) et planifie l'envoi après le commit. Un envoi déjà réservé (même clé) est ignoré. */
export async function notifyGuardian(deps: AdmissionsDeps, ctx: RequestContext, tx: Tx, scope: TxScope, input: NotifyInput): Promise<NotifyHandle> {
  let status: Delivery = "QUEUED";
  const channelGuess = input.recipient.email ? "EMAIL" : "SMS";
  const reserved = await cases.reserveNotification(tx, {
    id: deps.newId(),
    tenantId: input.tenantId,
    applicationId: input.applicationId,
    guardianId: input.recipient.id,
    channel: channelGuess,
    templateCode: input.templateCode,
    dedupeKey: input.dedupeKey,
  });
  if (!reserved) {
    status = "SKIPPED";
    return { status: () => status };
  }

  if (input.oncePerContactPerDay) {
    const contact = (input.recipient.email ?? input.recipient.phone ?? "").toLowerCase();
    const day = deps.clock.now().toISOString().slice(0, 10);
    const key = `contact:${hmacHex(deps.fingerprintSecret, contact).slice(0, 40)}:${day}`;
    const since = new Date(deps.clock.now().getTime() - deps.config.confirmationDedupeHours * 3_600_000).toISOString();
    const already = await cases.recentNotificationExists(tx, { guardianContactKey: key, templateCode: input.templateCode, since });
    // La clé « contact » est portée par une SECONDE ligne (clé distincte) : elle sert de verrou de jour pour ce contact.
    const lock = await cases.reserveNotification(tx, {
      id: deps.newId(),
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      guardianId: input.recipient.id,
      channel: channelGuess,
      templateCode: input.templateCode,
      dedupeKey: key,
    });
    if (already || !lock) {
      await cases.finishNotification(tx, reserved, { status: "SKIPPED", errorCode: "CONTACT_DAILY_LIMIT" });
      if (lock) await cases.finishNotification(tx, lock, { status: "SKIPPED", errorCode: "CONTACT_DAILY_LIMIT" });
      status = "SKIPPED";
      return { status: () => status };
    }
    await cases.finishNotification(tx, lock, { status: "QUEUED" });
  }

  const message: ApplicantMessage = {
    applicationId: input.applicationId,
    guardianId: input.recipient.id,
    templateCode: input.templateCode,
    recipient: { firstName: input.recipient.firstName, email: input.recipient.email, phone: input.recipient.phone },
    data: input.data ?? {},
    dedupeKey: input.dedupeKey,
  };
  scope.after(async () => {
    let outcome: { status: Delivery; channel?: string; providerRef?: string | null; errorCode?: string | null };
    try {
      const receipt = await deps.ports.notifier.send(ctx, message);
      outcome = { status: receipt.status, channel: receipt.channel, providerRef: receipt.providerRef ?? null };
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code: string }).code) : "SEND_FAILED";
      outcome = code === ERR_CHANNEL || code === "admissions.port_unavailable" ? { status: "SKIPPED", errorCode: "CHANNEL_UNAVAILABLE" } : { status: "FAILED", errorCode: code.slice(0, 80) };
      if (outcome.status === "FAILED") deps.logger.warn({ applicationId: input.applicationId, template: input.templateCode, code }, "admissions : envoi de notification en échec");
    }
    status = outcome.status;
    await deps.db.run(ctx, async (tx2) => {
      await cases.finishNotification(tx2, reserved, outcome);
    });
  });
  return { status: () => status };
}

/** Destinataire par défaut d'un dossier : tuteur principal, sinon premier tuteur. */
export function defaultRecipient(guardians: ReadonlyArray<{ id: string; firstName: string; email: string | null; phone: string | null; isPrimary: boolean }>): Recipient | null {
  const g = guardians.find((x) => x.isPrimary) ?? guardians[0];
  return g ? { id: g.id, firstName: g.firstName, email: g.email, phone: g.phone } : null;
}
