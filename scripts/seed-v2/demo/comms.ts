/**
 * Communication, pilotage et alertes : annonces (messagerie interne ; les notifications externes sont mises en file en mode
 * SIMULATION, jamais envoyées), règles d'alerte de direction (évaluées toutes les 15 minutes par le worker) et reconstruction
 * des tableaux de bord de direction à partir des événements de la démonstration.
 */
import type { DemoKit } from "./kit";

export async function seedCommunications(kit: DemoKit): Promise<void> {
  const { ctx } = kit;
  const { directeur, owner } = ctx;
  await directeur.post(
    "/api/v1/messaging/announcements",
    {
      title: "Rentrée : réunion d'information des parents (démonstration)",
      body: "Les parents sont invités à la réunion d'information de la rentrée. Annonce de démonstration : aucun envoi réel.",
      priority: "NORMAL",
      audience: { targets: [{ kind: "TENANT" }], audiences: ["GUARDIANS", "STAFF"] },
      requireAck: true,
      pinned: true,
      publish: true,
    },
    [200, 201],
  );
  await directeur.post(
    "/api/v1/messaging/announcements",
    { title: "Brouillon : calendrier des compositions (démonstration)", body: "Brouillon d'annonce à compléter et publier.", audience: { targets: [{ kind: "TENANT" }], audiences: ["GUARDIANS"] }, publish: false },
    [200, 201],
  );
  kit.count("announcements", 2);

  const rules: Array<Record<string, unknown>> = [
    { label: "Créances en retard élevées", metric: "OVERDUE_AMOUNT", warningValue: 100_000, criticalValue: 500_000, recipientRoles: ["directeur", "econome"], frequency: "DAILY" },
    { label: "Taux de recouvrement bas", metric: "COLLECTION_RATE", warningValue: 6000, criticalValue: 3000, recipientRoles: ["directeur", "econome"], frequency: "DAILY" },
    { label: "Taux de présence bas", metric: "ATTENDANCE_RATE", warningValue: 9000, criticalValue: 8000, windowDays: 30, recipientRoles: ["directeur", "directeur_etudes"], frequency: "DAILY" },
  ];
  let created = 0;
  for (const rule of rules) {
    const r = await owner.raw("POST", "/api/v1/analytics/alerts/rules", rule);
    if (r.status === 201 || r.status === 200) created += 1;
  }
  kit.count("alertRules", created);

  // Tableaux de bord de direction : reconstruction complète (événements reçus pendant le seed), puis attente de la fraîcheur.
  await owner.post("/api/v1/analytics/rebuild", {}, [200, 202]);
  kit.note("Pilotage : tableaux de bord de direction reconstruits ; 3 règles d'alerte configurées (évaluées toutes les 15 minutes : les premières alertes apparaissent après le prochain passage du worker).");
}
