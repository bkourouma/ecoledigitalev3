/**
 * notifications -> schoollife : `NotificationPort` — information des tuteurs (convocation, avis de mesure) par l'envoi MANUEL du
 * module `notifications` (mise en file dans la transaction de l'appelant : même contexte, donc SAVEPOINT ; le worker envoie).
 *
 *  - CONVOCATION : gabarit dédié `schoollife_convocation` (date, heure, lieu, élève ; texte neutre) ;
 *  - MEASURE_NOTICE : gabarit dédié `schoollife_measure_notified` avec un texte NEUTRE (« une décision de vie scolaire concernant …
 *    est disponible dans l'application ») : jamais le motif ni la nature de la mesure dans un SMS ou un e-mail.
 *    (Codes en snake_case : la base impose `^[a-z][a-z0-9_]+$` aux codes de gabarit.)
 *  - destinataires : tous les tuteurs vivants de l'élève, ou — si la liste est restreinte — les comptes des tuteurs choisis ;
 *    aucun destinataire joignable = ÉCHEC explicite (le statut de la convocation ou de la mesure ne change pas).
 */
import type { NotifManualAudience } from "@ecoledigitale/contracts/src/v2/notifications";
import { createNotificationsDeps, sendManualNotification, type NotificationsDeps } from "../../modules/notifications";
import type { NotificationPort, PeoplePort } from "../../modules/schoollife";
import type { AdapterKit } from "./kit";
import { createNotificationsDirectory } from "./people-notifications";

export function createSchoollifeNotificationsDeps(kit: AdapterKit): NotificationsDeps {
  return createNotificationsDeps({
    db: kit.tenantDb,
    clock: kit.clock,
    logger: kit.logger,
    config: { appBaseUrl: kit.env.V2_APP_BASE_URL?.replace(/\/+$/, "") ?? null },
    portsProvider: () => ({ directory: createNotificationsDirectory({ people: kit.people, academic: kit.academic, lookups: kit.lookups, tenantDb: kit.tenantDb, clock: kit.clock }) }),
  });
}

export function createSchoollifeNotificationPort(notifications: NotificationsDeps, people: Pick<PeoplePort, "listGuardiansOfStudent">): NotificationPort {
  return {
    async notifyGuardians(ctx, input) {
      const guardians = await people.listGuardiansOfStudent(ctx, input.studentId);
      const all = guardians.length > 0 && guardians.every((g) => input.guardianIds.includes(g.guardianId));
      const chosen = guardians.filter((g) => input.guardianIds.includes(g.guardianId));
      const userIds = chosen.map((g) => g.userId).filter((u): u is string => u !== null);
      if (!all && userIds.length === 0) throw new Error("Aucun des tuteurs choisis n'a de compte joignable.");
      const audience: NotifManualAudience = all ? { kind: "STUDENT_GUARDIANS", studentIds: [input.studentId], financialFirst: false } : { kind: "USERS", userIds };
      const isConvocation = input.kind === "CONVOCATION";
      // Gabarits dédiés (texte neutre, livrés par `notifications`) : jamais le motif ni la nature de la mesure.
      const variables = isConvocation
        ? { date: input.variables.date ?? "", time: input.variables.time ?? "", place: input.variables.place ?? "", studentName: input.variables.studentName ?? "votre enfant" }
        : { studentName: input.variables.studentName ?? "votre enfant" };
      const r = await sendManualNotification(
        notifications,
        ctx,
        { templateCode: isConvocation ? "schoollife_convocation" : "schoollife_measure_notified", audience, variables, channels: [...input.channels], strategy: "ALL", urgent: false, clientKey: `schoollife:${input.clientKey}` },
        { urgent: false },
      );
      if (!r.ok) {
        if (/port_unavailable$/.test(r.error.code)) throw r.error;
        throw new Error(r.error.message);
      }
      if (r.value.deliveries === 0 && !r.value.reused) throw new Error("Aucune remise n'a pu être mise en file (consentements, canaux ou coordonnées).");
      return { recipients: r.value.recipients, queued: r.value.deliveries };
    },
  };
}
