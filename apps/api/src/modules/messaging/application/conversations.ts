/**
 * Cas d'usage des conversations : création (directe, de groupe, diffusion), réponse, lecture, état par utilisateur,
 * retrait, recherche. Toute écriture : données -> notifications -> événements d'outbox -> audit (en dernier), dans UNE
 * transaction. Les règles « vis-à-vis de qui » viennent de `domain/policy.ts` ; les profils, des ports.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  MessagingConversationDetailDto,
  MessagingConversationSummaryDto,
  MessagingMessageDto,
  MessagingRecipients,
  MessagingPriority,
} from "@ecoledigitale/contracts/src/v2/messaging";
import { conflict, forbidden, MessagingCode, notFound, validation } from "../domain/errors";
import { MessagingEvents } from "../domain/events";
import {
  canBroadcast,
  canInitiate,
  canTargetClassroom,
  canUseAboutStudent,
  canUseAudience,
  DENY_MESSAGES,
  evaluateRecipient,
  participantLimit,
  REPLY_BLOCK_MESSAGES,
  replyBlock,
  type DenyReason,
} from "../domain/policy";
import { decodeCursor, directKey, encodeCursor, previewOf, systemKey } from "../domain/text";
import type { ActorProfile, CallerCaps, MessagingSettings, Uuid } from "../domain/types";
import * as repo from "../infrastructure/conversations-repository";
import * as notif from "../infrastructure/notifications-repository";
import * as settingsRepo from "../infrastructure/settings-repository";
import { EventBuffer, inTx, type MessagingDeps } from "./deps";
import {
  actorDisplayName,
  assertNotRestricted,
  checkBodyLength,
  enforceQuotas,
  loadActor,
  notifyNewMessage,
  notifyNewMessages,
  UNKNOWN_NAME,
  validateAttachmentIds,
} from "./support";
import { conversationSummary, messageView, participantView, rawMessageView } from "./views";

/** Plafond des « contacts de l'administration » joints à un message (parité legacy : 30 administrateurs). */
export const ADMIN_CONTACT_CAP = 30;

// ---------------------------------------------------------------------------
// Résolution des destinataires
// ---------------------------------------------------------------------------

interface Resolved {
  readonly recipients: Map<Uuid, string>;
  /** Classe visée quand un seul bloc de classe est demandé (contexte du fil). */
  readonly classroomId: Uuid | null;
  readonly truncated: boolean;
}

function denied(reason: DenyReason, userId: Uuid | null, hideDetail: boolean): AppError {
  return forbidden(MessagingCode.RECIPIENT_NOT_ALLOWED, DENY_MESSAGES[reason], hideDetail || userId === null ? { reason } : { reason, userId });
}

async function resolveRecipients(
  deps: MessagingDeps,
  ctx: RequestContext,
  tx: Tx,
  input: { caps: CallerCaps; actor: ActorProfile; settings: MessagingSettings; kind: "DIRECT" | "GROUP" | "BROADCAST"; recipients: MessagingRecipients; limit: number },
): Promise<Result<Resolved, AppError>> {
  const { caps, actor, settings, recipients: sel } = input;
  const out = new Map<Uuid, string>();
  let classroomId: Uuid | null = null;
  let truncated = false;
  const dir = deps.ports.directory;

  // Contacts de l'administration : seulement si une règle ou la demande en a besoin.
  let adminContacts: ReadonlySet<Uuid> = new Set();
  const needsAdmin = sel.toAdministration || !caps.sendAny;
  let adminList: readonly { userId: Uuid; displayName: string }[] = [];
  if (needsAdmin && settings.adminContactRoles.length > 0) {
    adminList = (await dir.listUsersWithRoles(ctx, settings.adminContactRoles)).slice(0, ADMIN_CONTACT_CAP * 4);
    adminContacts = new Set(adminList.map((c) => c.userId));
  }

  // 1. Destinataires explicites : profil + règle de lien.
  if (sel.userIds.length > 0) {
    const profiles = await dir.getProfiles(ctx, sel.userIds);
    for (const id of new Set(sel.userIds)) {
      const target = profiles.get(id);
      if (!target) {
        // Un compte inconnu, inactif ou d'un autre tenant : même refus qu'un destinataire interdit (pas d'énumération de comptes).
        return err(caps.sendAny ? notFound(MessagingCode.RECIPIENT_NOT_FOUND, "Destinataire", id) : denied("NOT_LINKED", null, true));
      }
      const decision = evaluateRecipient({ caps, actor, target, settings, adminContacts });
      if (!decision.allowed) return err(denied(decision.reason, id, !caps.sendAny));
      out.set(id, target.displayName ?? UNKNOWN_NAME);
    }
  }

  // 2. Classes en bloc.
  for (const block of sel.classrooms) {
    const decision = canTargetClassroom(caps, actor, block.classroomId, block.include);
    if (!decision.allowed) return err(denied(decision.reason, null, false));
    const room = await dir.listClassroomContacts(ctx, block.classroomId, block.include);
    if (!room.classroom) return err(notFound(MessagingCode.RECIPIENT_NOT_FOUND, "Classe", block.classroomId));
    classroomId = sel.classrooms.length === 1 ? block.classroomId : null;
    for (const c of room.contacts) out.set(c.userId, c.displayName);
  }

  // 3. Audience par cibles (administration).
  if (sel.audience) {
    if (!canUseAudience(caps)) return err(forbidden(MessagingCode.TARGET_NOT_ALLOWED, "La diffusion par audience est réservée à l'administration."));
    const unknown = await deps.ports.audience.firstUnknownTarget(ctx, sel.audience.targets);
    if (unknown) return err(notFound(MessagingCode.TARGET_NOT_FOUND, "Cible", unknown.ref ?? unknown.kind));
    const aud = await deps.ports.audience.resolveAudience(ctx, { targets: sel.audience.targets, audiences: sel.audience.audiences, limit: input.limit + 1 });
    truncated = aud.truncated;
    const names = await dir.getDisplayNames(ctx, aud.userIds);
    for (const id of aud.userIds) out.set(id, names.get(id) ?? UNKNOWN_NAME);
  }

  // 4. « Écrire à l'administration ».
  if (sel.toAdministration) {
    const allowed = caps.sendAny || caps.send || caps.childSend || (caps.selfSend && settings.studentPolicy === "TEACHERS_AND_ADMIN");
    if (!allowed) return err(denied(actor.studentId ? "STUDENT_POLICY" : "NOT_LINKED", null, false));
    if (adminList.length === 0) return err(notFound(MessagingCode.RECIPIENT_NOT_FOUND, "Contact d'administration"));
    for (const c of adminList.slice(0, ADMIN_CONTACT_CAP)) out.set(c.userId, c.displayName);
  }

  out.delete(actor.userId);
  return ok({ recipients: out, classroomId, truncated });
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export interface CreateConversationInput {
  readonly kind: "DIRECT" | "GROUP" | "BROADCAST";
  readonly subject?: string | undefined;
  readonly priority: MessagingPriority;
  readonly body: string;
  readonly recipients: MessagingRecipients;
  readonly aboutStudentId?: Uuid | undefined;
  readonly allowReplies?: boolean | undefined;
  readonly attachmentIds: readonly Uuid[];
  readonly clientId?: Uuid | undefined;
  readonly caps?: CallerCaps | undefined;
}

export interface SendResult {
  readonly conversation: MessagingConversationSummaryDto | null;
  readonly message: MessagingMessageDto | null;
  readonly broadcastId: Uuid | null;
  readonly reused: boolean;
  readonly recipientCount: number;
}

const flagGroupAudit = (kind: string): boolean => kind !== "DIRECT";

export async function createConversation(deps: MessagingDeps, ctx: RequestContext, input: CreateConversationInput): Promise<Result<SendResult, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Un message est envoyé par un utilisateur identifié."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const body = checkBodyLength(input.body, settings);
    if (!body.ok) return body;
    const actor = await loadActor(deps, ctx, me);
    const cannot = canInitiate(caps, actor, settings);
    if (cannot) {
      return err(
        forbidden(cannot === "STUDENT_POLICY" ? MessagingCode.STUDENT_MESSAGING_DISABLED : MessagingCode.FORBIDDEN, DENY_MESSAGES[cannot], { reason: cannot }),
      );
    }
    const restricted = await assertNotRestricted(tx, deps, ctx, me);
    if (!restricted.ok) return restricted;

    // Idempotence d'un réessai du client (fenêtre de 24 h).
    if (input.clientId) {
      const replay = await replayByClientId(tx, deps, ctx, me, input.clientId);
      if (replay) return ok(replay);
    }
    const quotas = await enforceQuotas(tx, deps, ctx, me, settings, { newConversation: true });
    if (!quotas.ok) return quotas;

    if (input.kind === "BROADCAST" && !canBroadcast(caps, actor)) return err(forbidden(MessagingCode.RECIPIENT_NOT_ALLOWED, DENY_MESSAGES.FORBIDDEN_KIND, { reason: "FORBIDDEN_KIND" }));
    if (input.aboutStudentId && !canUseAboutStudent(caps, actor, input.aboutStudentId)) return err(forbidden(MessagingCode.RECIPIENT_NOT_ALLOWED, DENY_MESSAGES.NOT_YOUR_CHILD, { reason: "NOT_YOUR_CHILD" }));

    const limit = input.kind === "DIRECT" ? 1 : participantLimit(input.kind, caps, settings);
    const resolved = await resolveRecipients(deps, ctx, tx, { caps, actor, settings, kind: input.kind, recipients: input.recipients, limit });
    if (!resolved.ok) return resolved;
    const { recipients, classroomId, truncated } = resolved.value;
    if (recipients.size === 0) return err(validation(MessagingCode.AUDIENCE_EMPTY, "Aucun destinataire joignable pour cette sélection.", "recipients"));
    if (input.kind === "DIRECT" && recipients.size !== 1) return err(validation(MessagingCode.INVALID_INPUT, "Une conversation directe a exactement un destinataire.", "recipients"));
    // `limit` = plafond de DESTINATAIRES (l'expéditeur n'est pas compté pour une diffusion, il l'est pour un groupe).
    const total = input.kind === "GROUP" ? recipients.size + 1 : recipients.size;
    if (truncated || total > limit) {
      return err(validation(MessagingCode.TOO_MANY_RECIPIENTS, `Trop de destinataires (${total}) : le maximum est ${limit}.`, "recipients", { max: limit, count: total }));
    }

    const attachments = await validateAttachmentIds(tx, ctx, settings, me, input.attachmentIds);
    if (!attachments.ok) return attachments;

    const senderName = await actorDisplayName(deps, ctx, actor);
    const events = new EventBuffer(deps, ctx);
    const subject = input.subject?.trim() || null;
    const base = { deps, ctx, tx, events, now, me, senderName, body: body.value, subject, priority: input.priority, aboutStudentId: input.aboutStudentId ?? null, classroomId, clientId: input.clientId ?? null, attachments: attachments.value };

    let result: SendResult;
    if (input.kind === "BROADCAST") result = await createBroadcast(base, recipients);
    else if (input.kind === "DIRECT") result = await createDirect(base, [...recipients.entries()][0]!);
    else result = await createGroup({ ...base, allowReplies: input.allowReplies ?? true }, recipients);

    if (flagGroupAudit(input.kind)) {
      events.audit({
        action: "messaging.conversation.created",
        resourceType: "conversation",
        resourceId: result.conversation?.id ?? result.broadcastId ?? "broadcast",
        metadata: { kind: input.kind, recipientCount: result.recipientCount, broadcastId: result.broadcastId },
      });
    }
    await events.flush(tx);
    return ok(result);
  });
}

type CreationBase = {
  deps: MessagingDeps;
  ctx: RequestContext;
  tx: Tx;
  events: EventBuffer;
  now: Date;
  me: Uuid;
  senderName: string;
  body: string;
  subject: string | null;
  priority: MessagingPriority;
  aboutStudentId: Uuid | null;
  classroomId: Uuid | null;
  clientId: Uuid | null;
  attachments: repo.AttachmentRow[];
};

async function bindToMessage(b: CreationBase, messageId: Uuid): Promise<void> {
  if (b.attachments.length === 0) return;
  const bound = await repo.bindAttachments(b.tx, b.ctx.tenantId, b.attachments.map((a) => a.id), { messageId }, b.me, b.now);
  if (bound !== b.attachments.length) throw validation(MessagingCode.ATTACHMENT_NOT_FOUND, "Pièce jointe introuvable ou déjà utilisée.", "attachmentIds");
}

function emitSent(b: CreationBase, conversationId: Uuid, messageId: Uuid, recipientCount: number, created: { kind: "DIRECT" | "GROUP"; participantCount: number } | null): void {
  if (created) {
    b.events.add(
      MessagingEvents.CONVERSATION_CREATED,
      { v: 1, conversationId, kind: created.kind, createdBy: b.me, participantCount: created.participantCount, classroomId: b.classroomId, aboutStudentId: b.aboutStudentId },
      { type: "conversation", id: conversationId },
    );
  }
  b.events.add(
    MessagingEvents.MESSAGE_SENT,
    { v: 1, conversationId, messageId, senderId: b.me, kind: "USER", recipientCount, attachmentCount: b.attachments.length, systemCode: null },
    { type: "conversation", id: conversationId },
  );
}

/** Replay d'un envoi déjà enregistré avec ce `clientId` (réessai du client : aucun doublon). */
async function replayByClientId(tx: Tx, deps: MessagingDeps, ctx: RequestContext, me: Uuid, clientId: Uuid): Promise<SendResult | null> {
  const since = new Date(deps.clock.now().getTime() - 86_400_000);
  const rows = await repo.findMessagesByClientId(tx, ctx.tenantId, me, clientId, since);
  const first = rows[0];
  if (!first) return null;
  if (first.broadcastId) return { conversation: null, message: null, broadcastId: first.broadcastId, reused: true, recipientCount: rows.length };
  const row = await repo.getInboxRow(tx, ctx.tenantId, me, first.conversationId);
  const msg = await repo.getMessage(tx, ctx.tenantId, first.id);
  if (!row || !msg) return null;
  const briefs = await repo.listParticipantBriefs(tx, ctx.tenantId, [row.id], me);
  const atts = await repo.listAttachmentsOfMessages(tx, ctx.tenantId, [msg.id]);
  return { conversation: conversationSummary(row, briefs), message: messageView(msg, me, atts), broadcastId: null, reused: true, recipientCount: Math.max(0, (briefs[0]?.total ?? 0)) };
}

async function summaryFor(tx: Tx, ctx: RequestContext, me: Uuid, conversationId: Uuid): Promise<MessagingConversationSummaryDto | null> {
  const row = await repo.getInboxRow(tx, ctx.tenantId, me, conversationId);
  if (!row) return null;
  return conversationSummary(row, await repo.listParticipantBriefs(tx, ctx.tenantId, [conversationId], me));
}

// -- DIRECT -----------------------------------------------------------------

async function createDirect(b: CreationBase, recipient: [Uuid, string]): Promise<SendResult> {
  const [recipientId, recipientName] = recipient;
  const key = directKey(b.me, recipientId, b.aboutStudentId, b.subject);
  const existing = (await repo.findConversationsByKeys(b.tx, b.ctx.tenantId, [key]))[0];
  if (existing) {
    const posted = await appendToConversation(b, existing.id, { reuse: true });
    return { ...posted, broadcastId: null, reused: true, recipientCount: 1 };
  }
  const id = b.deps.newId();
  const inserted = await repo.insertConversations(b.tx, b.ctx.tenantId, [
    { id, kind: "DIRECT", subject: b.subject, priority: b.priority, broadcastId: null, createdBy: b.me, aboutStudentId: b.aboutStudentId, classroomId: null, directKey: key, allowReplies: true, createdAt: b.now },
  ]);
  if (inserted.length === 0) {
    // Course : un autre envoi vient de créer le fil.
    const raced = (await repo.findConversationsByKeys(b.tx, b.ctx.tenantId, [key]))[0]!;
    const posted = await appendToConversation(b, raced.id, { reuse: true });
    return { ...posted, broadcastId: null, reused: true, recipientCount: 1 };
  }
  await repo.insertParticipants(b.tx, b.ctx.tenantId, [
    { conversationId: id, userId: b.me, role: "OWNER", displayName: b.senderName, addedAt: b.now, lastReadSeq: 1, lastReadAt: b.now, archivedAt: null },
    { conversationId: id, userId: recipientId, role: "MEMBER", displayName: recipientName, addedAt: b.now, lastReadSeq: 0, lastReadAt: null, archivedAt: null },
  ]);
  const messageId = await insertFirstMessage(b, id);
  await notifyNewMessage(b.tx, b.ctx, b.now, { conversationId: id, recipients: [{ userId: recipientId, notificationId: b.deps.newId() }], senderName: b.senderName, subject: b.subject, kind: "USER" });
  emitSent(b, id, messageId, 1, { kind: "DIRECT", participantCount: 2 });
  const message = await repo.getMessage(b.tx, b.ctx.tenantId, messageId);
  const atts = await repo.listAttachmentsOfMessages(b.tx, b.ctx.tenantId, [messageId]);
  return { conversation: await summaryFor(b.tx, b.ctx, b.me, id), message: messageView(message!, b.me, atts), broadcastId: null, reused: false, recipientCount: 1 };
}

async function insertFirstMessage(b: CreationBase, conversationId: Uuid, options: { broadcastId?: Uuid | null } = {}): Promise<Uuid> {
  const messageId = b.deps.newId();
  await repo.insertMessages(b.tx, b.ctx.tenantId, [
    { id: messageId, conversationId, seq: 1, kind: "USER", senderId: b.me, senderName: b.senderName, body: b.body, broadcastId: options.broadcastId ?? null, clientId: b.clientId, createdAt: b.now },
  ]);
  await repo.touchConversation(b.tx, b.ctx.tenantId, conversationId, { seq: 1, at: b.now, preview: previewOf(b.body) });
  await bindToMessage(b, messageId);
  return messageId;
}

// -- GROUP ------------------------------------------------------------------

async function createGroup(b: CreationBase & { allowReplies: boolean }, recipients: Map<Uuid, string>): Promise<SendResult> {
  const id = b.deps.newId();
  await repo.insertConversations(b.tx, b.ctx.tenantId, [
    { id, kind: "GROUP", subject: b.subject, priority: b.priority, broadcastId: null, createdBy: b.me, aboutStudentId: b.aboutStudentId, classroomId: b.classroomId, directKey: null, allowReplies: b.allowReplies, createdAt: b.now },
  ]);
  await repo.insertParticipants(b.tx, b.ctx.tenantId, [
    { conversationId: id, userId: b.me, role: "OWNER", displayName: b.senderName, addedAt: b.now, lastReadSeq: 1, lastReadAt: b.now, archivedAt: null },
    ...[...recipients.entries()].map(([userId, displayName]) => ({ conversationId: id, userId, role: "MEMBER" as const, displayName, addedAt: b.now, lastReadSeq: 0, lastReadAt: null, archivedAt: null })),
  ]);
  const messageId = await insertFirstMessage(b, id);
  await notifyNewMessage(b.tx, b.ctx, b.now, {
    conversationId: id,
    recipients: [...recipients.keys()].map((userId) => ({ userId, notificationId: b.deps.newId() })),
    senderName: b.senderName,
    subject: b.subject,
    kind: "USER",
  });
  emitSent(b, id, messageId, recipients.size, { kind: "GROUP", participantCount: recipients.size + 1 });
  const message = await repo.getMessage(b.tx, b.ctx.tenantId, messageId);
  const atts = await repo.listAttachmentsOfMessages(b.tx, b.ctx.tenantId, [messageId]);
  return { conversation: await summaryFor(b.tx, b.ctx, b.me, id), message: messageView(message!, b.me, atts), broadcastId: null, reused: false, recipientCount: recipients.size };
}

// -- BROADCAST --------------------------------------------------------------

/**
 * Diffusion : un fil DIRECT PRIVÉ par destinataire (ils ne se voient pas), même message, même `broadcast_id`. Les fils
 * nouveaux sont insérés par lots (une requête par table) ; un fil existant (même paire, objet, élève) reçoit le message.
 * Les fils de l'expéditeur sont archivés : ils ressortent à la première réponse.
 */
async function createBroadcast(b: CreationBase, recipients: Map<Uuid, string>): Promise<SendResult> {
  const broadcastId = b.deps.newId();
  const entries = [...recipients.entries()].map(([userId, name]) => ({ userId, name, key: directKey(b.me, userId, b.aboutStudentId, b.subject), id: b.deps.newId() }));
  const existing = new Map((await repo.findConversationsByKeys(b.tx, b.ctx.tenantId, entries.map((e) => e.key))).map((c) => [c.directKey!, c]));
  const fresh = entries.filter((e) => !existing.has(e.key));
  const created = await repo.insertConversations(
    b.tx,
    b.ctx.tenantId,
    fresh.map((e) => ({ id: e.id, kind: "DIRECT" as const, subject: b.subject, priority: b.priority, broadcastId, createdBy: b.me, aboutStudentId: b.aboutStudentId, classroomId: b.classroomId, directKey: e.key, allowReplies: true, createdAt: b.now })),
  );
  const createdKeys = new Set(created.map((c) => c.directKey));
  const inserted = fresh.filter((e) => createdKeys.has(e.key));
  // Course sur une clé : traitée comme un fil existant.
  const raced = fresh.filter((e) => !createdKeys.has(e.key));
  if (raced.length > 0) for (const c of await repo.findConversationsByKeys(b.tx, b.ctx.tenantId, raced.map((e) => e.key))) existing.set(c.directKey!, c);

  await repo.insertParticipants(
    b.tx,
    b.ctx.tenantId,
    inserted.flatMap((e) => [
      { conversationId: e.id, userId: b.me, role: "OWNER" as const, displayName: b.senderName, addedAt: b.now, lastReadSeq: 1, lastReadAt: b.now, archivedAt: b.now },
      { conversationId: e.id, userId: e.userId, role: "MEMBER" as const, displayName: e.name, addedAt: b.now, lastReadSeq: 0, lastReadAt: null, archivedAt: null },
    ]),
  );
  const messages = inserted.map((e) => ({ conversationId: e.id, messageId: b.deps.newId() }));
  await repo.insertMessages(
    b.tx,
    b.ctx.tenantId,
    messages.map((m) => ({ id: m.messageId, conversationId: m.conversationId, seq: 1, kind: "USER" as const, senderId: b.me, senderName: b.senderName, body: b.body, broadcastId, clientId: b.clientId, createdAt: b.now })),
  );
  const preview = previewOf(b.body);
  for (const m of messages) await repo.touchConversation(b.tx, b.ctx.tenantId, m.conversationId, { seq: 1, at: b.now, preview });

  const notifyRows: Array<{ userId: Uuid; notificationId: Uuid; conversationId: Uuid }> = inserted.map((e) => ({ userId: e.userId, notificationId: b.deps.newId(), conversationId: e.id }));
  const messageIds = messages.map((m) => m.messageId);
  // Fils existants : le message s'y ajoute (même transaction).
  for (const e of entries.filter((x) => existing.has(x.key))) {
    const conv = existing.get(e.key)!;
    const posted = await appendToConversation(b, conv.id, { reuse: true, broadcastId, silent: true, skipAttachments: true });
    messageIds.push(posted.message.id);
    notifyRows.push({ userId: e.userId, notificationId: b.deps.newId(), conversationId: conv.id });
    b.events.add(
      MessagingEvents.MESSAGE_SENT,
      { v: 1, conversationId: conv.id, messageId: posted.message.id, senderId: b.me, kind: "USER", recipientCount: 1, attachmentCount: b.attachments.length, systemCode: null },
      { type: "conversation", id: conv.id },
    );
  }

  // Pièces : l'original se lie au premier message, les autres reçoivent une copie de ligne.
  if (b.attachments.length > 0 && messageIds.length > 0) {
    await bindToMessage(b, messageIds[0]!);
    await repo.insertAttachmentClones(
      b.tx,
      b.ctx.tenantId,
      b.attachments.map((a) => a.id),
      messageIds.slice(1).map((messageId) => ({ messageId, newIds: b.attachments.map(() => b.deps.newId()) })),
      b.now,
    );
  }
  await notifyNewMessages(b.tx, b.ctx, b.now, { senderName: b.senderName, subject: b.subject, rows: notifyRows });
  for (const m of messages) {
    b.events.add(MessagingEvents.CONVERSATION_CREATED, { v: 1, conversationId: m.conversationId, kind: "DIRECT", createdBy: b.me, participantCount: 2, classroomId: b.classroomId, aboutStudentId: b.aboutStudentId }, { type: "conversation", id: m.conversationId });
    b.events.add(
      MessagingEvents.MESSAGE_SENT,
      { v: 1, conversationId: m.conversationId, messageId: m.messageId, senderId: b.me, kind: "USER", recipientCount: 1, attachmentCount: b.attachments.length, systemCode: null },
      { type: "conversation", id: m.conversationId },
    );
  }
  return { conversation: null, message: null, broadcastId, reused: false, recipientCount: entries.length };
}

// ---------------------------------------------------------------------------
// Réponse dans un fil
// ---------------------------------------------------------------------------

/**
 * Ajoute un message à un fil EXISTANT (sans contrôle de droits : l'appelant les a faits). Verrouille la ligne du fil
 * (seq sans trou), marque le fil lu pour l'auteur, le désarchive pour les autres, notifie les participants actifs
 * hors sourdine. `silent` : pas de notification ni d'événement (diffusion, qui les écrit elle-même).
 */
async function appendToConversation(
  b: CreationBase,
  conversationId: Uuid,
  options: { reuse?: boolean; broadcastId?: Uuid | null; silent?: boolean; skipAttachments?: boolean },
): Promise<{ conversation: MessagingConversationSummaryDto | null; message: MessagingMessageDto }> {
  const conversation = await repo.getConversation(b.tx, b.ctx.tenantId, conversationId, { forUpdate: true });
  if (!conversation) throw notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", conversationId);
  if (b.clientId) {
    const dup = await repo.findMessageByClientId(b.tx, b.ctx.tenantId, conversationId, b.me, b.clientId);
    if (dup) {
      const atts = await repo.listAttachmentsOfMessages(b.tx, b.ctx.tenantId, [dup.id]);
      return { conversation: await summaryFor(b.tx, b.ctx, b.me, conversationId), message: messageView(dup, b.me, atts) };
    }
  }
  const seq = conversation.lastSeq + 1;
  const messageId = b.deps.newId();
  await repo.insertMessages(b.tx, b.ctx.tenantId, [
    { id: messageId, conversationId, seq, kind: "USER", senderId: b.me, senderName: b.senderName, body: b.body, broadcastId: options.broadcastId ?? null, clientId: b.clientId, createdAt: b.now },
  ]);
  await repo.touchConversation(b.tx, b.ctx.tenantId, conversationId, { seq, at: b.now, preview: previewOf(b.body) });
  await repo.markRead(b.tx, b.ctx.tenantId, conversationId, b.me, seq, b.now);
  await repo.unarchiveOthers(b.tx, b.ctx.tenantId, conversationId, b.me);
  if (options.broadcastId) await repo.setBroadcastIdIfNull(b.tx, b.ctx.tenantId, conversationId, options.broadcastId);
  if (!options.skipAttachments) await bindToMessage(b, messageId);
  const others = (await repo.listParticipants(b.tx, b.ctx.tenantId, conversationId)).filter((p) => p.userId !== b.me && p.leftAt === null);
  if (!options.silent) {
    await notifyNewMessage(b.tx, b.ctx, b.now, {
      conversationId,
      recipients: others.filter((p) => !p.muted).map((p) => ({ userId: p.userId, notificationId: b.deps.newId() })),
      senderName: b.senderName,
      subject: conversation.subject,
      kind: "USER",
    });
    emitSent(b, conversationId, messageId, others.length, null);
  }
  const message = await repo.getMessage(b.tx, b.ctx.tenantId, messageId);
  const atts = await repo.listAttachmentsOfMessages(b.tx, b.ctx.tenantId, [messageId]);
  return { conversation: await summaryFor(b.tx, b.ctx, b.me, conversationId), message: messageView(message!, b.me, atts) };
}

export interface PostMessageInput {
  readonly conversationId: Uuid;
  readonly body: string;
  readonly attachmentIds: readonly Uuid[];
  readonly clientId?: Uuid | undefined;
  readonly caps?: CallerCaps | undefined;
}

export async function postMessage(deps: MessagingDeps, ctx: RequestContext, input: PostMessageInput): Promise<Result<{ message: MessagingMessageDto; conversation: MessagingConversationSummaryDto | null }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Un message est envoyé par un utilisateur identifié."));
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const conversation = await repo.getConversation(tx, ctx.tenantId, input.conversationId, { forUpdate: true });
    const participant = conversation ? await repo.getParticipant(tx, ctx.tenantId, conversation.id, me) : null;
    // Pas participant (ou parti) : 404, jamais la confirmation que le fil existe.
    if (!conversation || !participant || participant.leftAt) return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
    const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
    const restriction = await settingsRepo.getActiveRestriction(tx, ctx.tenantId, me, now);
    const block = replyBlock({
      caps,
      settings,
      conversation: { kind: conversation.kind, closed: conversation.closedAt !== null, allowReplies: conversation.allowReplies },
      participant: { role: participant.role, left: participant.leftAt !== null },
      restricted: restriction !== null,
    });
    if (block) {
      const code =
        block === "CLOSED" ? MessagingCode.CONVERSATION_CLOSED : block === "REPLIES_DISABLED" ? MessagingCode.REPLIES_DISABLED : block === "RESTRICTED" ? MessagingCode.SENDER_RESTRICTED : block === "STUDENT_POLICY" ? MessagingCode.STUDENT_MESSAGING_DISABLED : MessagingCode.FORBIDDEN;
      return err(forbidden(code, REPLY_BLOCK_MESSAGES[block], { reason: block }));
    }
    const body = checkBodyLength(input.body, settings);
    if (!body.ok) return body;
    const quotas = await enforceQuotas(tx, deps, ctx, me, settings, { newConversation: false });
    if (!quotas.ok) return quotas;
    const attachments = await validateAttachmentIds(tx, ctx, settings, me, input.attachmentIds);
    if (!attachments.ok) return attachments;
    const events = new EventBuffer(deps, ctx);
    const b: CreationBase = {
      deps, ctx, tx, events, now, me, senderName: participant.displayName, body: body.value, subject: conversation.subject, priority: conversation.priority,
      aboutStudentId: conversation.aboutStudentId, classroomId: conversation.classroomId, clientId: input.clientId ?? null, attachments: attachments.value,
    };
    const posted = await appendToConversation(b, conversation.id, {});
    await events.flush(tx);
    return ok(posted);
  });
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export interface ListConversationsInput {
  readonly folder: "inbox" | "archived" | "starred" | "sent";
  readonly q?: string | undefined;
  readonly unreadOnly?: boolean | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export async function listConversations(deps: MessagingDeps, ctx: RequestContext, input: ListConversationsInput): Promise<Result<{ items: MessagingConversationSummaryDto[]; nextCursor: string | null }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const cursor = decodeCursor(input.cursor);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listInbox(tx, ctx.tenantId, me, { folder: input.folder, q: input.q, unreadOnly: input.unreadOnly, cursor, limit: input.limit + 1 });
      const page = rows.slice(0, input.limit);
      const briefs = await repo.listParticipantBriefs(tx, ctx.tenantId, page.map((r) => r.id), me);
      const last = page[page.length - 1];
      const hasMore = rows.length > input.limit && last !== undefined;
      return ok({
        items: page.map((r) => conversationSummary(r, briefs)),
        nextCursor: hasMore ? encodeCursor({ t: (last.lastMessageAt ?? last.createdAt).toISOString(), id: last.id }) : null,
      });
    },
    { readOnly: true },
  );
}

export async function getConversationDetail(deps: MessagingDeps, ctx: RequestContext, input: { conversationId: Uuid; caps?: CallerCaps | undefined }): Promise<Result<MessagingConversationDetailDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await repo.getInboxRow(tx, ctx.tenantId, me, input.conversationId);
      if (!row) return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
      const participants = await repo.listParticipants(tx, ctx.tenantId, row.id);
      const mine = participants.find((p) => p.userId === me) ?? null;
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const restriction = await settingsRepo.getActiveRestriction(tx, ctx.tenantId, me, deps.clock.now());
      const block = replyBlock({
        caps,
        settings,
        conversation: { kind: row.kind, closed: row.closedAt !== null, allowReplies: row.allowReplies },
        participant: mine ? { role: mine.role, left: mine.leftAt !== null } : null,
        restricted: restriction !== null,
      });
      const active = participants.filter((p) => p.leftAt === null);
      return ok({
        conversation: conversationSummary(row, await repo.listParticipantBriefs(tx, ctx.tenantId, [row.id], me)),
        participants: active.map((p) => participantView({ userId: p.userId, displayName: p.displayName, role: p.role, left: false })),
        canReply: block === null,
        replyBlockedReason: block ? REPLY_BLOCK_MESSAGES[block] : null,
      });
    },
    { readOnly: true },
  );
}

export async function listConversationMessages(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { conversationId: Uuid; before?: number | undefined; limit: number },
): Promise<Result<{ items: MessagingMessageDto[]; nextBefore: number | null }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const participant = await repo.getParticipant(tx, ctx.tenantId, input.conversationId, me);
      if (!participant || participant.leftAt) return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
      const rows = await repo.listMessages(tx, ctx.tenantId, input.conversationId, { before: input.before, limit: input.limit + 1 });
      const page = rows.slice(0, input.limit);
      const atts = await repo.listAttachmentsOfMessages(tx, ctx.tenantId, page.map((m) => m.id));
      const oldest = page[page.length - 1];
      return ok({
        items: page.reverse().map((m) => messageView(m, me, atts)),
        nextBefore: rows.length > input.limit && oldest ? oldest.seq : null,
      });
    },
    { readOnly: true },
  );
}

/** Marque le fil lu (jusqu'à `upToSeq`, sinon jusqu'au dernier message) et lit sa notification. */
export async function markConversationRead(deps: MessagingDeps, ctx: RequestContext, input: { conversationId: Uuid; upToSeq?: number | undefined }): Promise<Result<{ lastReadSeq: number; unreadCount: number }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getInboxRow(tx, ctx.tenantId, me, input.conversationId);
    if (!row) return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
    const target = Math.min(row.lastSeq, input.upToSeq ?? row.lastSeq);
    const now = deps.clock.now();
    await repo.markRead(tx, ctx.tenantId, row.id, me, target, now);
    const lastReadSeq = Math.max(row.lastReadSeq, target);
    if (lastReadSeq >= row.lastSeq) await notif.markNotificationReadByKey(tx, ctx.tenantId, me, `msg:${row.id}`, now);
    return ok({ lastReadSeq, unreadCount: Math.max(0, row.lastSeq - lastReadSeq) });
  });
}

export async function setParticipantState(
  deps: MessagingDeps,
  ctx: RequestContext,
  input: { conversationId: Uuid; archived?: boolean | undefined; muted?: boolean | undefined; starred?: boolean | undefined },
): Promise<Result<MessagingConversationSummaryDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getInboxRow(tx, ctx.tenantId, me, input.conversationId);
    if (!row) return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
    await repo.updateParticipantState(tx, ctx.tenantId, row.id, me, input, deps.clock.now());
    const fresh = (await summaryFor(tx, ctx, me, row.id))!;
    return ok(fresh);
  });
}

/** Quitter un fil de GROUPE (un fil direct s'archive, il ne se quitte pas). Le dernier propriétaire parti, le fil reste lisible par les autres. */
export async function leaveConversation(deps: MessagingDeps, ctx: RequestContext, input: { conversationId: Uuid }): Promise<Result<true, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const row = await repo.getInboxRow(tx, ctx.tenantId, me, input.conversationId);
    if (!row) return err(notFound(MessagingCode.CONVERSATION_NOT_FOUND, "Conversation", input.conversationId));
    if (row.kind !== "GROUP") return err(conflict(MessagingCode.INVALID_INPUT, "Seul un fil de groupe peut être quitté : archivez les autres."));
    await repo.leaveConversation(tx, ctx.tenantId, row.id, me, deps.clock.now());
    return ok(true);
  });
}

// ---------------------------------------------------------------------------
// Retrait par l'auteur, recherche, compteurs
// ---------------------------------------------------------------------------

export async function removeOwnMessage(deps: MessagingDeps, ctx: RequestContext, input: { messageId: Uuid }): Promise<Result<true, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(deps, ctx, async (tx) => {
    const msg = await repo.getMessage(tx, ctx.tenantId, input.messageId);
    const participant = msg ? await repo.getParticipant(tx, ctx.tenantId, msg.conversationId, me) : null;
    if (!msg || !participant || participant.leftAt || msg.senderId !== me) return err(notFound(MessagingCode.MESSAGE_NOT_FOUND, "Message", input.messageId));
    const events = new EventBuffer(deps, ctx);
    if (await repo.markMessageRemoved(tx, ctx.tenantId, msg.id, { by: me, kind: "SENDER", reason: null, at: deps.clock.now() })) {
      await refreshPreview(tx, ctx, msg.conversationId);
      events.add(MessagingEvents.MESSAGE_REMOVED, { v: 1, conversationId: msg.conversationId, messageId: msg.id, removedBy: me, removalKind: "SENDER" }, { type: "conversation", id: msg.conversationId });
    }
    await events.flush(tx);
    return ok(true);
  });
}

/** Recalcule l'aperçu du fil depuis le dernier message NON retiré. */
export async function refreshPreview(tx: Tx, ctx: RequestContext, conversationId: Uuid): Promise<void> {
  const last = await repo.lastVisibleMessage(tx, ctx.tenantId, conversationId);
  await repo.setConversationPreview(tx, ctx.tenantId, conversationId, last ? previewOf(last.body) : null);
}

export async function searchMyMessages(deps: MessagingDeps, ctx: RequestContext, input: { q: string; limit: number }) {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.searchMessages(tx, ctx.tenantId, me, input.q, input.limit);
      return ok({
        items: rows.map((r) => ({
          conversationId: r.conversationId,
          messageId: r.messageId,
          seq: r.seq,
          subject: r.subject,
          senderName: r.senderName,
          snippet: snippetOf(r.body, input.q),
          createdAt: r.createdAt.toISOString(),
        })),
      });
    },
    { readOnly: true },
  );
}

/** Extrait de ~140 caractères autour de la première occurrence (insensible aux accents et à la casse). */
export function snippetOf(body: string, query: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const at = norm(flat).indexOf(norm(query).trim());
  if (at < 0 || flat.length <= 140) return previewOf(flat);
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, at + query.length + 80);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------
// Messages système (fil d'alertes d'un destinataire)
// ---------------------------------------------------------------------------

export interface SystemMessageInput {
  readonly userIds: readonly Uuid[];
  readonly code: string;
  readonly title: string;
  readonly body: string;
  readonly payload?: Record<string, unknown> | undefined;
  /** Clé d'idempotence (ex. `evt:<id>`) : rejouer l'événement ne crée aucun doublon. */
  readonly dedupeKey: string;
}

/** Publie un message système dans le fil d'alertes de chaque destinataire (créé au besoin). Retourne le nombre de messages créés. */
export async function postSystemMessages(deps: MessagingDeps, ctx: RequestContext, input: SystemMessageInput): Promise<Result<{ delivered: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);
    let delivered = 0;
    for (const userId of [...new Set(input.userIds)]) {
      const key = systemKey(userId);
      let conversation = (await repo.findConversationsByKeys(tx, ctx.tenantId, [key]))[0];
      if (!conversation) {
        const id = deps.newId();
        await repo.insertConversations(tx, ctx.tenantId, [
          { id, kind: "SYSTEM", subject: "Alertes", priority: "NORMAL", broadcastId: null, createdBy: null, aboutStudentId: null, classroomId: null, directKey: key, allowReplies: false, createdAt: now },
        ]);
        await repo.insertParticipants(tx, ctx.tenantId, [{ conversationId: id, userId, role: "MEMBER", displayName: "EcoleDigitale", addedAt: now, lastReadSeq: 0, lastReadAt: null, archivedAt: null }]);
        conversation = (await repo.findConversationsByKeys(tx, ctx.tenantId, [key]))[0];
        if (conversation) events.add(MessagingEvents.CONVERSATION_CREATED, { v: 1, conversationId: id, kind: "SYSTEM", createdBy: null, participantCount: 1, classroomId: null, aboutStudentId: null }, { type: "conversation", id });
      }
      if (!conversation) continue;
      const locked = (await repo.getConversation(tx, ctx.tenantId, conversation.id, { forUpdate: true }))!;
      if (await repo.findMessageByDedupeKey(tx, ctx.tenantId, locked.id, input.dedupeKey)) continue;
      const seq = locked.lastSeq + 1;
      const messageId = deps.newId();
      const body = `${input.title}\n\n${input.body}`;
      const inserted = await repo.insertMessages(tx, ctx.tenantId, [
        { id: messageId, conversationId: locked.id, seq, kind: "SYSTEM", senderId: null, senderName: null, body, systemCode: input.code, systemPayload: input.payload ?? null, dedupeKey: input.dedupeKey, createdAt: now },
      ]);
      if (inserted.length === 0) continue;
      await repo.touchConversation(tx, ctx.tenantId, locked.id, { seq, at: now, preview: previewOf(input.title) });
      await repo.unarchiveOthers(tx, ctx.tenantId, locked.id, "00000000-0000-0000-0000-000000000000");
      await notifyNewMessage(tx, ctx, now, { conversationId: locked.id, recipients: [{ userId, notificationId: deps.newId() }], senderName: "EcoleDigitale", subject: input.title, kind: "SYSTEM", title: input.title });
      events.add(
        MessagingEvents.MESSAGE_SENT,
        { v: 1, conversationId: locked.id, messageId, senderId: null, kind: "SYSTEM", recipientCount: 1, attachmentCount: 0, systemCode: input.code },
        { type: "conversation", id: locked.id },
      );
      delivered += 1;
    }
    await events.flush(tx);
    return ok({ delivered });
  });
}

export { rawMessageView };
