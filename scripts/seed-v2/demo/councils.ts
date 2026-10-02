/**
 * Conseil de classe (pack Secondary) : séance de la première période créée, participants convoqués et présents (président,
 * secrétaire, enseignants de la classe), dossier préparé (faits figés des résultats FINAL) et séance OUVERTE : les propositions
 * et décisions restent à saisir par les humains. Le module ne calcule rien ; le jeu de règles reste celui de démonstration.
 */
import type { Actor } from "../actors";
import { at, today, type DemoKit } from "./kit";

export async function seedCouncil(kit: DemoKit): Promise<void> {
  const { ctx } = kit;
  const { owner, directeur, teacher } = ctx;
  const types = (await directeur.get("/api/v1/councils/council-types")).body.items as Array<{ id: string; code: string; scope?: string }>;
  const periodType = types.find((t) => t.code === "PERIOD_COUNCIL") ?? at(types, 0, "type de conseil");

  // Fiches de personnel du président et du secrétaire (la direction et le secrétariat siègent comme personnel).
  const cats = (await owner.get("/api/v1/people/reference/staff-categories")).body.items as Array<{ code: string }>;
  const category = at(cats, 0, "catégorie de personnel").code;
  const staffIds: Record<string, string> = {};
  for (const [key, last, first, mail] of [["president", "PRESIDENT", "Conseil", "president"], ["secretary", "SECRETAIRE", "Conseil", "secretaire"]] as const) {
    const s = await owner.post("/api/v1/people/staff", { person: { lastName: last, firstName: first, sex: "F", birthDate: "1979-03-02", email: `${mail}.conseil@${ctx.data.slug}.test` }, categoryCode: category, hiredOn: "2018-09-01" }, 201);
    staffIds[key] = (s.body.staff?.id ?? s.body.id) as string;
  }

  const created = await directeur.post(
    "/api/v1/councils/councils",
    { classroomId: ctx.classroomId, academicPeriodId: at(ctx.periodIds, 1, "seconde période"), councilTypeId: periodType.id, title: "Conseil de classe de la période 2 (démonstration)", scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    201,
  );
  const councilId = created.body.id as string;
  const add = async (actor: Actor, roleCode: string, staffId: string, councilFunction?: string): Promise<string> => {
    const r = await actor.post(`/api/v1/councils/councils/${councilId}/participants`, { roleCode, staffId, ...(councilFunction ? { councilFunction } : {}) }, 201);
    await actor.post(`/api/v1/councils/councils/${councilId}/participants/${r.body.id}/presence`, { presence: "PRESENT" });
    return r.body.id as string;
  };
  await add(directeur, "PRESIDENT", staffIds.president as string, "PRESIDENT");
  await add(directeur, "SECRETARY", staffIds.secretary as string, "SECRETARY");
  const proposed = (await directeur.get(`/api/v1/councils/councils/${councilId}/proposed-participants`)).body.items as Array<{ staffId: string; roleCode: string }>;
  for (const p of proposed) await add(directeur, p.roleCode, p.staffId);
  await directeur.post(`/api/v1/councils/councils/${councilId}/prepare`, {});
  const opened = await directeur.post(`/api/v1/councils/councils/${councilId}/open`, {});
  if (opened.body.council?.status !== "OPEN") throw new Error(`Ouverture du conseil inattendue : ${JSON.stringify(opened.body).slice(0, 300)}`);

  // Une proposition de l'enseignant sur le premier dossier (il propose, il ne décide pas).
  const agenda = (await directeur.get(`/api/v1/councils/councils/${councilId}/agenda`)).body.items as Array<{ id: string }>;
  if (agenda[0]) await teacher.post(`/api/v1/councils/agenda/${agenda[0].id}/proposals`, { kind: "APPRECIATION", body: "Élève sérieux et appliqué (proposition de démonstration)." }, 201);
  kit.count("councils", 1);
  kit.count("councilItems", agenda.length);
  kit.note(`Conseil de classe : séance OUVERTE (${agenda.length} dossiers, présence saisie, une proposition) ; décisions à prendre par la direction.`);
  void today;
}
