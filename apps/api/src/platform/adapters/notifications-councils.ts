/**
 * notifications (+ people) -> councils : `NotificationPort` — convocation du PERSONNEL et information NEUTRE des tuteurs, par l'envoi MANUEL
 * du module `notifications` (mise en file dans la transaction de l'appelant : même contexte, donc SAVEPOINT ; le worker envoie).
 *
 *  - Convocation : gabarit livré `announcement` (titre, résumé : classe, date, lieu). Les destinataires sont les COMPTES liés aux fiches du
 *    personnel (`identityId`) ; un membre sans compte joignable est un ÉCHEC explicite (jamais « envoyé » sans remise réelle).
 *  - Tuteurs : texte NEUTRE (« une décision du conseil de classe concernant … est disponible dans l'application ») — jamais le contenu de la
 *    décision, jamais dans un SMS. Seuls les canaux application, e-mail et notification push sont demandés (fournisseur SMS non choisi).
 *  - Idempotence : `clientKey` préfixée ; un réessai ne double pas l'envoi.
 */
import { getStaffByIds, type PeopleDeps } from "../../modules/people";
import { sendManualNotification, type NotificationsDeps } from "../../modules/notifications";
import type { CouncilsNotificationPort } from "../../modules/councils";

const CHANNELS = ["IN_APP", "EMAIL", "PUSH"] as const;

export function createCouncilsNotificationPort(notifications: NotificationsDeps, people: PeopleDeps): CouncilsNotificationPort {
  return {
    async notifyParticipants(ctx, { councilId, staffIds, variables, clientKey }) {
      const staff = await getStaffByIds(people, ctx, [...staffIds]);
      if (!staff.ok) throw staff.error;
      const userIds = staff.value.map((s) => s.identityId).filter((u): u is string => typeof u === "string");
      if (userIds.length === 0) throw new Error("Aucun des membres convoqués n'a de compte joignable.");
      const when = [variables.date, variables.time].filter((x) => x && x.length > 0).join(" à ");
      const r = await sendManualNotification(
        notifications,
        ctx,
        {
          templateCode: "announcement",
          audience: { kind: "USERS", userIds },
          variables: { title: variables.subject ?? "Convocation au conseil de classe", summary: `Vous êtes convoqué(e) au conseil de classe${variables.classroomName ? ` de la classe ${variables.classroomName}` : ""}${when ? ` le ${when}` : ""}${variables.place ? `, ${variables.place}` : ""}.` },
          channels: [...CHANNELS],
          strategy: "ALL",
          urgent: false,
          clientKey: `councils:${councilId}:${clientKey}`,
        },
        { urgent: false },
      );
      if (!r.ok) {
        if (/port_unavailable$/.test(r.error.code)) throw r.error;
        throw new Error(r.error.message);
      }
      if (r.value.deliveries === 0 && !r.value.reused) throw new Error("Aucune remise n'a pu être mise en file (consentements, canaux ou coordonnées).");
      return { recipients: r.value.recipients, queued: r.value.deliveries };
    },

    async notifyGuardians(ctx, { studentId, studentName, clientKey }) {
      const r = await sendManualNotification(
        notifications,
        ctx,
        {
          templateCode: "announcement",
          audience: { kind: "STUDENT_GUARDIANS", studentIds: [studentId], financialFirst: false },
          variables: { title: "Conseil de classe : une information vous concerne", summary: `Une décision du conseil de classe concernant ${studentName} est disponible dans l'application.` },
          channels: [...CHANNELS],
          strategy: "ALL",
          urgent: false,
          clientKey: `councils:guardians:${clientKey}`,
        },
        { urgent: false },
      );
      if (!r.ok) {
        if (/port_unavailable$/.test(r.error.code)) throw r.error;
        throw new Error(r.error.message);
      }
      if (r.value.deliveries === 0 && !r.value.reused) throw new Error("Aucune remise n'a pu être mise en file (aucun tuteur joignable, consentements ou canaux).");
      return { recipients: r.value.recipients, queued: r.value.deliveries };
    },
  };
}
