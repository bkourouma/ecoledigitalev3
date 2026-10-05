/**
 * Sélecteur de destinataires AUTORISÉS et profil d'audience de l'utilisateur (`GET /recipients`, `GET /me/audience`).
 * Le sélecteur n'expose QUE des personnes que l'appelant a le droit d'écrire (mêmes règles que l'envoi) : le client ne
 * déduit rien, il affiche ce qui revient.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { MessagingMyAudienceDto, MessagingRecipientDto, MessagingRecipientKind } from "@ecoledigitale/contracts/src/v2/messaging";
import { forbidden, MessagingCode } from "../domain/errors";
import { applicableRules, canInitiate, evaluateRecipient, previousYearOpen } from "../domain/policy";
import type { ActorProfile, CallerCaps, DirectoryContact, MessagingClassInclude, Uuid } from "../domain/types";
import * as settingsRepo from "../infrastructure/settings-repository";
import { ADMIN_CONTACT_CAP } from "./conversations";
import { inTx, type MessagingDeps } from "./deps";
import { loadActor } from "./support";

const INCLUDE_BY_KIND: Readonly<Record<MessagingRecipientKind, MessagingClassInclude>> = Object.freeze({ STUDENT: "STUDENTS", GUARDIAN: "GUARDIANS", STAFF: "TEACHERS" });

export interface RecipientQuery {
  readonly q?: string | undefined;
  readonly classroomId?: Uuid | undefined;
  readonly kind?: MessagingRecipientKind | undefined;
  readonly limit: number;
  readonly caps?: CallerCaps | undefined;
}

function dto(c: DirectoryContact, relation: string): MessagingRecipientDto {
  return { userId: c.userId, displayName: c.displayName, kind: c.kind, relation, classroomId: c.classroomId ?? null, studentId: c.studentId ?? null };
}

function relationOf(c: DirectoryContact, classroomName: string | null, admin: boolean): string {
  if (admin) return "Administration";
  if (c.kind === "GUARDIAN") return c.studentName ? `Parent de ${c.studentName}` : "Parent";
  if (c.kind === "STUDENT") return classroomName ? `Élève — ${classroomName}` : "Élève";
  return classroomName ? `Enseignant — ${classroomName}` : "Personnel";
}

export async function listAllowedRecipients(deps: MessagingDeps, ctx: RequestContext, input: RecipientQuery): Promise<Result<{ items: MessagingRecipientDto[] }, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const actor = await loadActor(deps, ctx, me);
      if (canInitiate(caps, actor, settings)) return ok({ items: [] });
      const rules = applicableRules(caps, actor, settings);
      const dir = deps.ports.directory;
      const out = new Map<Uuid, MessagingRecipientDto>();
      const add = (c: DirectoryContact, relation: string) => {
        if (c.userId !== me && !out.has(c.userId) && (!input.kind || input.kind === c.kind)) out.set(c.userId, dto(c, relation));
      };

      const needsAdmin = !caps.sendAny && (rules.includes("R3") || rules.includes("R4") || rules.includes("R2"));
      const adminList = needsAdmin && settings.adminContactRoles.length > 0 ? (await dir.listUsersWithRoles(ctx, settings.adminContactRoles)).slice(0, ADMIN_CONTACT_CAP) : [];
      const adminIds = new Set(adminList.map((c) => c.userId));

      if (input.classroomId) {
        // Une classe : l'administration la voit toute ; le personnel seulement SES classes ; un tuteur / un élève, les enseignants de la classe.
        const room = input.classroomId;
        const mayBlock = caps.sendAny || (rules.includes("R2") && actor.teachingClassroomIds.includes(room));
        const include: MessagingClassInclude[] = mayBlock ? (input.kind ? [INCLUDE_BY_KIND[input.kind]] : ["STUDENTS", "GUARDIANS", "TEACHERS"]) : ["TEACHERS"];
        const mine = mayBlock || actor.childClassroomIds.includes(room) || actor.studentClassroomIds.includes(room);
        // Q-05 : la classe d'un enfant l'année précédente, tant que la fenêtre est ouverte (enseignants seulement).
        const previousYear = !mine && rules.includes("R3") && previousYearOpen(actor, settings, deps.clock.now()) && (actor.childPreviousYearClassroomIds ?? []).includes(room);
        if (mine) {
          const res = await dir.listClassroomContacts(ctx, room, include);
          for (const c of res.contacts) add(c, relationOf(c, res.classroom?.name ?? null, false));
        } else if (previousYear) {
          const res = await dir.listClassroomContacts(ctx, room, ["TEACHERS"], { previousYear: true });
          for (const c of res.contacts) add(c, relationOf(c, res.classroom?.name ?? null, false));
        }
      } else if (input.q) {
        // Recherche par nom, FILTRÉE par les règles : on ne propose que des personnes que l'on a le droit d'écrire.
        const found = await dir.searchUsers(ctx, input.q, Math.min(input.limit * 2, 100));
        const profiles = await dir.getProfiles(ctx, found.map((f) => f.userId));
        for (const c of found) {
          const target = profiles.get(c.userId);
          if (!target) continue;
          if (evaluateRecipient({ caps, actor, target, settings, adminContacts: adminIds, now: deps.clock.now() }).allowed) add(c, relationOf(c, null, adminIds.has(c.userId)));
        }
      } else {
        // Sans critère : les contacts « naturels » (enseignants des classes de l'enfant / de l'élève, administration).
        const rooms = [...new Set([...actor.childClassroomIds, ...actor.studentClassroomIds])];
        if (rules.includes("R3") || rules.includes("R4")) {
          for (const room of rooms) {
            const res = await dir.listClassroomContacts(ctx, room, ["TEACHERS"]);
            for (const c of res.contacts) add(c, relationOf(c, res.classroom?.name ?? null, false));
          }
        }
        // Q-05 : les enseignants de l'année précédente de ses enfants, tant que la fenêtre est ouverte.
        if (rules.includes("R3") && previousYearOpen(actor, settings, deps.clock.now())) {
          for (const room of actor.childPreviousYearClassroomIds ?? []) {
            if (rooms.includes(room)) continue;
            const res = await dir.listClassroomContacts(ctx, room, ["TEACHERS"], { previousYear: true });
            for (const c of res.contacts) add(c, relationOf(c, res.classroom?.name ?? null, false));
          }
        }
        for (const c of adminList) add({ ...c, kind: "STAFF" }, "Administration");
      }
      return ok({ items: [...out.values()].slice(0, input.limit) });
    },
    { readOnly: true },
  );
}

/** Profil d'audience de l'utilisateur : droits, classes qu'il peut écrire en bloc, politique élève, restriction. */
export async function getMyAudience(deps: MessagingDeps, ctx: RequestContext, input: { caps?: CallerCaps | undefined }): Promise<Result<MessagingMyAudienceDto, AppError>> {
  const me = ctx.userId;
  if (!me) return err(forbidden(MessagingCode.FORBIDDEN, "Utilisateur identifié requis."));
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await settingsRepo.getSettings(tx, ctx.tenantId);
      const actor: ActorProfile = await loadActor(deps, ctx, me);
      const restriction = await settingsRepo.getActiveRestriction(tx, ctx.tenantId, me, deps.clock.now());
      const roomIds = caps.send && actor.staffId ? actor.teachingClassroomIds : [];
      const names = roomIds.length > 0 ? await deps.ports.directory.getClassroomNames(ctx, roomIds) : new Map<Uuid, string>();
      return ok({
        userId: me,
        canSend: canInitiate(caps, actor, settings) === null && restriction === null,
        canSendAny: caps.sendAny === true,
        canPublishAnnouncements: caps.announcementPublish === true || caps.announcementPublishClass === true || caps.announcementManage === true,
        canManageAnnouncements: caps.announcementManage === true,
        canModerate: caps.moderationRead === true || caps.moderationManage === true || caps.moderationSupervise === true,
        classrooms: roomIds.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
        studentPolicy: settings.studentPolicy,
        isStudent: actor.studentId !== null,
        isGuardian: actor.childStudentIds.length > 0,
        isStaff: actor.staffId !== null,
        restrictedUntil: restriction?.restrictedUntil?.toISOString() ?? null,
        restricted: restriction !== null,
      });
    },
    { readOnly: true },
  );
}
