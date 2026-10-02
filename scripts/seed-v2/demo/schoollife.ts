/**
 * Vie scolaire (pack Secondary, et éducateur du pack Primary) : types d'événements de DÉMONSTRATION (donnée d'établissement
 * marquée `isPlaceholder` : aucun catalogue de fautes livré, aucune règle de sanction inventée), incidents déclarés par
 * l'enseignant et l'éducateur, observations et encouragements, mesures PROPOSÉES puis VALIDÉES par un humain différent
 * (quatre yeux) ; l'effet sur le statut de l'élève reste en attente d'un acte humain, que la direction applique pour un cas.
 */
import type { Actor } from "../actors";
import { addDays, at, today, type DemoKit } from "./kit";

export async function seedSchoolLife(kit: DemoKit, input: { educateur: Actor }): Promise<void> {
  const { ctx } = kit;
  const owner = ctx.owner;
  const active = ctx.students.slice(0, ctx.data.paidCount);

  await owner.put("/api/v1/schoollife/severity-levels", { code: "NIVEAU1", label: "Niveau 1 (démonstration)", rank: 1 });
  await owner.put("/api/v1/schoollife/severity-levels", { code: "NIVEAU2", label: "Niveau 2 (démonstration)", rank: 2 });
  const incident = await owner.put("/api/v1/schoollife/event-types", { code: "INCIDENT_DEMO", label: "Incident en classe (démonstration)", kind: "INCIDENT", isPlaceholder: true });
  const warning = await owner.put("/api/v1/schoollife/event-types", { code: "AVERTISSEMENT_DEMO", label: "Avertissement (démonstration)", kind: "WARNING", requiresValidation: true, notifyGuardians: true, isPlaceholder: true });
  const exclusion = await owner.put("/api/v1/schoollife/event-types", {
    code: "EXCLUSION_DEMO",
    label: "Exclusion temporaire (démonstration)",
    kind: "TEMP_EXCLUSION",
    requiresValidation: true,
    requiresFourEyes: true,
    requiresDates: true,
    notifyGuardians: true,
    appealable: true,
    isPlaceholder: true,
  });
  const encouragement = await owner.put("/api/v1/schoollife/event-types", { code: "ENCOURAGEMENT_DEMO", label: "Encouragement (démonstration)", kind: "ENCOURAGEMENT", isPlaceholder: true });
  const observation = await owner.put("/api/v1/schoollife/event-types", { code: "OBSERVATION_DEMO", label: "Observation (démonstration)", kind: "OBSERVATION", isPlaceholder: true });

  // Incidents : un par l'enseignant de la classe, un par l'éducateur.
  const i1 = await ctx.teacher.post(
    "/api/v1/schoollife/incidents",
    { typeId: incident.body.id, occurredAt: new Date().toISOString(), description: "Bavardage répété pendant le cours (incident de démonstration).", involvements: [{ enrollmentId: at(active, 1, "élève").enrollmentId, role: "AUTHOR" }] },
    [200, 201],
  );
  const i2 = await input.educateur.post(
    "/api/v1/schoollife/incidents",
    { typeId: incident.body.id, occurredAt: new Date().toISOString(), description: "Retard à la reprise après la récréation (incident de démonstration).", involvements: [{ enrollmentId: at(active, 3, "élève").enrollmentId, role: "AUTHOR" }] },
    [200, 201],
  );
  kit.count("incidents", 2);

  // Observations et encouragements.
  await input.educateur.post("/api/v1/schoollife/notes", { enrollmentId: at(active, 0, "élève").enrollmentId, typeId: encouragement.body.id, body: "Très bonne participation cette semaine.", occurredOn: today(), visibility: "STAFF_ONLY" }, [200, 201]);
  await ctx.teacher.post("/api/v1/schoollife/notes", { enrollmentId: at(active, 2, "élève").enrollmentId, typeId: observation.body.id, body: "Besoin d'un accompagnement en lecture.", occurredOn: today(), visibility: "STAFF_ONLY" }, [200, 201]);
  kit.count("lifeNotes", 2);

  // Mesure 1 : avertissement proposé par l'éducateur, validé par la direction.
  const m1 = await input.educateur.post("/api/v1/schoollife/measures", { enrollmentId: at(active, 3, "élève").enrollmentId, typeId: warning.body.id, incidentId: i2.body.id, reason: "Avertissement de démonstration après un retard répété." }, [200, 201]);
  await ctx.directeur.post(`/api/v1/schoollife/measures/${m1.body.id}/validate`, { note: "Validé par la direction (démonstration)." });

  // Mesure 2 : exclusion temporaire proposée (reste PROPOSED : à valider par un testeur, avec le compte direction).
  await input.educateur.post(
    "/api/v1/schoollife/measures",
    { enrollmentId: at(active, 6, "élève").enrollmentId, typeId: exclusion.body.id, reason: "Exclusion de démonstration proposée : en attente de la validation de la direction.", startsOn: addDays(today(), 1), endsOn: addDays(today(), 3) },
    [200, 201],
  );

  // Mesure 3 : exclusion validée (quatre yeux : proposée par l'éducateur, validée par la direction) ; effet appliqué par un humain.
  const m3 = await input.educateur.post(
    "/api/v1/schoollife/measures",
    { enrollmentId: at(active, 1, "élève").enrollmentId, typeId: exclusion.body.id, incidentId: i1.body.id, reason: "Exclusion de démonstration proposée après l'incident.", startsOn: addDays(today(), 1), endsOn: addDays(today(), 2) },
    [200, 201],
  );
  await ctx.directeur.post(`/api/v1/schoollife/measures/${m3.body.id}/validate`, { note: "Validée par la direction." });
  const effects = await ctx.directeur.get(`/api/v1/schoollife/measure-effects?measureId=${m3.body.id}`);
  const effect = (effects.body.items as Array<{ id: string; status: string }>)[0];
  if (effect && effect.status === "AWAITING_HUMAN") {
    // L'élève reste ACTIF tant qu'un humain n'applique pas l'effet ; on laisse CET effet en attente pour la démonstration (un testeur l'applique).
    kit.note("Vie scolaire : une exclusion validée a un effet sur le statut de l'élève EN ATTENTE d'un acte humain (à appliquer avec le compte direction).");
  }
  kit.count("measures", 3);
  kit.note("Vie scolaire : types d'événements de démonstration (aucun catalogue de fautes livré), 2 incidents, 2 notes, 3 mesures (1 validée, 1 proposée, 1 validée avec effet en attente).");
}
