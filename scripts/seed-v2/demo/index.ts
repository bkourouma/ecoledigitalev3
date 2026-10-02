/**
 * Prolongement de DÉMONSTRATION du scénario de base (`scripts/seed-v2/scenario.ts`) : un établissement riche pour chaque pack.
 * Appelé par `scripts/demo/seed.ts` (jamais par `pnpm seed:v2`). Tout passe par l'API HTTP publique avec de vrais comptes ;
 * aucune règle officielle n'est inventée (jeux de règles `placeholder`), aucun envoi réel, fournisseurs en SANDBOX.
 *
 * Une étape qui échoue est signalée (`⚠`) et n'interrompt pas la démonstration.
 */
import type { ScenarioContext } from "../scenario";
import { seedAdmissions } from "./admissions";
import { seedCommunications } from "./comms";
import { seedCouncil } from "./councils";
import { seedExams } from "./exams";
import { seedFinanceActivity } from "./finance";
import { seedImports } from "./imports";
import { createKit, type DemoKit } from "./kit";
import { seedMaternelle } from "./primary";
import { issueBulletins } from "./reportcards";
import { closeFirstPeriod, lockPeriod, publishFullGrades, publishSecondPeriodGrades } from "./results";
import { seedSchoolLife } from "./schoollife";
import { addStaffAccounts, type StaffActors } from "./staff";
import { seedStateAssigned } from "./stateassign";

export interface DemoOptions {
  /** Dossier des fichiers modèles d'import (sinon : non écrits). */
  importDir?: string | undefined;
}

export async function demoExtension(ctx: ScenarioContext, options: DemoOptions = {}): Promise<{ warnings: Array<{ step: string; message: string }> }> {
  const kit = createKit(ctx);
  let staff: StaffActors | null = null;
  const ok = await kit.step("rôles : direction des études, secrétariat, économe, éducateur, responsable des examens, chargé d'admissions", async () => {
    staff = await addStaffAccounts(kit);
  });
  if (!ok || !staff) return finish(kit);
  const s: StaffActors = staff;

  switch (ctx.data.pack) {
    case "SECONDARY":
      await secondary(kit, s);
      break;
    case "PRIMARY":
      await primary(kit, s);
      break;
    case "HIGHER":
      await higher(kit, s);
      break;
  }

  await kit.step("finances : règlements variés et paiements en ligne SANDBOX", () => seedFinanceActivity(kit, { econome: s.econome }));
  await kit.step("communication, règles d'alerte et tableaux de bord de direction", () => seedCommunications(kit));
  await kit.step("imports : fichiers modèles et un import d'élèves prêt à exécuter", () => seedImports(kit, { importer: s.secretariat, outDir: options.importDir }));
  return finish(kit);
}

function finish(kit: DemoKit): { warnings: Array<{ step: string; message: string }> } {
  kit.ctx.counts.warnings = kit.warnings.length;
  for (const w of kit.warnings) kit.ctx.notes.push(`⚠ ${w.step} : ${w.message.slice(0, 300)}`);
  return { warnings: kit.warnings };
}

// --------------------------------------------------------------------------------------------------------------- SECONDARY
async function secondary(kit: DemoKit, staff: StaffActors): Promise<void> {
  const { ctx } = kit;
  let enrolled: { studentId: string; enrollmentId: string } | null = null;
  await kit.step("admissions : campagne et candidatures à tous les statuts (6e)", async () => {
    const adm = await seedAdmissions(kit, { officer: staff.admissions, grade: "6E", classroomId: ctx.classroomId, registrationFee: ctx.data.registrationFee, birthYear: 2014, campaignCode: "RENTREE-6E" });
    enrolled = adm.enrolled[0] ?? null;
  });
  await kit.step("notes complètes (devoir et composition par matière) puis clôture de la période 1 : résultats par le jeu de règles de DÉMONSTRATION", async () => {
    await publishFullGrades(kit);
    await closeFirstPeriod(kit);
  });
  await kit.step("bulletins PDF signés de la période 1 (gabarit du secondaire)", async () => {
    await issueBulletins(kit, { pack: "SECONDARY", templateKey: "secondary-bulletin", legalName: ctx.data.tenantName.replace(" (démonstration)", "") });
  });
  await kit.step("vie scolaire : incidents, observations, mesures (quatre yeux)", () => seedSchoolLife(kit, { educateur: staff.educateur }));
  await kit.step("élèves affectés par l'État : dossier vérifié, facture scindée, créance", async () => {
    if (!enrolled) throw new Error("Aucun élève inscrit par l'admission (étape précédente en échec).");
    await seedStateAssigned(kit, { secretariat: staff.secretariat, studentId: (enrolled as { studentId: string }).studentId, enrollmentId: (enrolled as { enrollmentId: string }).enrollmentId, reference: "AFF-DEMO-0001" });
  });
  await kit.step("examens : session officielle et examen BLANC (règles de démonstration)", () => seedExams(kit, { examens: staff.examens, examLevel: "LOWER_SECONDARY", gradeLevelCode: "6E" }));
  await kit.step("période 2 : notes publiées et verrouillées, conseil de classe OUVERT", async () => {
    await ctx.owner.post(`/api/v1/academic/periods/${ctx.periodIds[1]}/open`, {}, [200, 201, 409]);
    await publishSecondPeriodGrades(kit);
    await lockPeriod(kit, 1);
    await seedCouncil(kit);
  });
}

// --------------------------------------------------------------------------------------------------------------- PRIMARY
async function primary(kit: DemoKit, staff: StaffActors): Promise<void> {
  const { ctx } = kit;
  await kit.step("CP1 : notes complètes puis clôture de la période 1 (règles de démonstration)", async () => {
    await publishFullGrades(kit);
    await closeFirstPeriod(kit);
  });
  await kit.step("bulletins PDF signés du CP1 (gabarit du primaire)", async () => {
    await issueBulletins(kit, { pack: "PRIMARY", templateKey: "primary-bulletin", legalName: ctx.data.tenantName.replace(" (démonstration)", "") });
  });
  await kit.step("maternelle : admission, inscription, appel journalier, compétences, résultats, conseil des maîtres, bilan annuel scellé", async () => {
    await seedMaternelle(kit, { officer: staff.admissions });
  });
}

// --------------------------------------------------------------------------------------------------------------- HIGHER
async function higher(kit: DemoKit, staff: StaffActors): Promise<void> {
  const { ctx } = kit;
  await kit.step("admissions : campagne et candidatures à tous les statuts (L1)", async () => {
    await seedAdmissions(kit, { officer: staff.admissions, grade: "L1", classroomId: ctx.classroomId, registrationFee: ctx.data.registrationFee, birthYear: 2005, campaignCode: "RENTREE-L1" });
  });
  await kit.step("notes complètes, liaison des règles LMD, clôture du semestre 1 (semestre validé = toutes les UE)", async () => {
    await publishFullGrades(kit);
    await ctx.owner.put("/api/v1/rules/bindings", { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
    await closeFirstPeriod(kit);
  });
  await kit.step("relevés de notes PDF signés du semestre 1 (gabarit du supérieur à crédits)", async () => {
    await issueBulletins(kit, { pack: "HIGHER", templateKey: "higher-bulletin-credits", legalName: ctx.data.tenantName.replace(" (démonstration)", "") });
  });
}
