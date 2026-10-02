/**
 * Imports : fichiers modèles CSV et XLSX de chaque importeur (écrits dans `.demo/import-templates/`, ignoré par git) et UN import
 * « prêt à tester » : le fichier d'élèves d'exemple (lignes FICTIVES du modèle) est téléversé, mappé et VALIDÉ ; l'aperçu est
 * disponible et l'exécution reste à lancer par le testeur (confirmation explicite).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor } from "../actors";
import { waitFor, type DemoKit } from "./kit";

const LAST = ["BEUGRE", "DJEDJE", "GOULI", "KACOU", "LAGO", "MOBIO", "NIAMKE", "OBOU", "PAPI", "SAHI", "TAGRO", "UBA", "VEI", "WOGNIN", "ZEBIE"];
const FIRST = ["Aurélie", "Boris", "Clarisse", "Dimitri", "Edwige", "Franck", "Gisèle", "Hamed", "Irène", "Josué", "Laure", "Marcel", "Nadège", "Olivier", "Prisca"];

/**
 * Fichier d'élèves de démonstration : l'en-tête du MODÈLE téléchargé (mêmes colonnes, même séparateur) et 15 lignes FICTIVES,
 * rattachées à la classe de l'établissement (code de la classe), sans doublon avec les élèves déjà présents.
 */
function demoStudentsCsv(template: string, classroomCode: string): string {
  const bom = String.fromCharCode(0xfeff);
  const lines = template.replace(bom, "").split(/\r?\n/);
  const header = (lines[0] ?? "").split(";");
  const col = (name: RegExp): number => header.findIndex((h) => name.test(h));
  const rows = LAST.map((last, i) => {
    const cells = header.map(() => "");
    const set = (re: RegExp, v: string): void => {
      const k = col(re);
      if (k >= 0) cells[k] = v;
    };
    set(/^Matricule/i, `IMP-${String(i + 1).padStart(4, "0")}`);
    set(/^Nom$/i, last);
    set(/^Pr[ée]noms/i, FIRST[i] as string);
    set(/^Sexe/i, i % 2 === 0 ? "F" : "M");
    set(/^Date de naissance/i, `${String(3 + i).padStart(2, "0")}/${String(1 + (i % 12)).padStart(2, "0")}/${2012 - (i % 2)}`);
    set(/^Lieu de naissance/i, "Abidjan");
    set(/^Nationalit/i, "CI");
    set(/^Classe/i, classroomCode);
    set(/^Financement/i, "PRIVATE");
    return cells.join(";");
  });
  return `${bom}${[header.join(";"), ...rows].join("\n")}\n`;
}

const IMPORTERS =["students", "guardians", "staff", "classrooms", "curriculum", "grades", "opening_balances"] as const;

export async function seedImports(kit: DemoKit, input: { importer: Actor; outDir: string | undefined }): Promise<void> {
  const { ctx } = kit;
  const { importer } = input;
  let written = 0;
  let studentsCsv: Buffer | null = null;
  for (const key of IMPORTERS) {
    for (const format of ["csv", "xlsx"] as const) {
      const res = await importer.raw("GET", `/api/v1/imports/importers/${key}/template?format=${format}`);
      if (res.status !== 200) continue;
      const bytes = res.raw ?? Buffer.from(typeof res.body === "string" ? res.body : JSON.stringify(res.body));
      if (key === "students" && format === "csv") studentsCsv = bytes;
      if (input.outDir) {
        const dir = resolve(input.outDir, ctx.data.slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `modele-${key}.${format}`), bytes);
        written += 1;
      }
    }
  }
  if (!studentsCsv) throw new Error("Modèle CSV des élèves indisponible.");
  const sample = demoStudentsCsv((studentsCsv as Buffer).toString("utf8"), ctx.data.classroomCode);

  const up = await importer.upload("POST", `/api/v1/imports/jobs?importer=students&fileName=${encodeURIComponent("eleves-demonstration.csv")}`, Buffer.from(sample, "utf8"), { "content-type": "text/csv; charset=utf-8" });
  if (up.status !== 201 && up.status !== 200) throw new Error(`Téléversement refusé : HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 300)}`);
  const jobId = (up.body.id ?? up.body.job?.id) as string;
  const mapping = up.body.suggestedMapping ?? up.body.job?.suggestedMapping;
  await importer.put(`/api/v1/imports/jobs/${jobId}/mapping`, { mapping, runMode: "VALID_ONLY", onExisting: "SKIP" });
  await importer.post(`/api/v1/imports/jobs/${jobId}/validate`, {}, [200, 202]);
  await waitFor(
    async () => {
      const job = (await importer.get(`/api/v1/imports/jobs/${jobId}`)).body;
      const status = (job.status ?? job.job?.status) as string;
      if (status === "FAILED") throw new Error("Validation de l'import en échec.");
      return status === "VALIDATED" ? status : false;
    },
    { label: "validation de l'import", timeoutMs: 90_000 },
  );
  kit.count("importTemplates", written);
  kit.note("Imports : fichiers modèles CSV/XLSX générés (dossier .demo/import-templates) et un import d'élèves VALIDÉ, prêt à exécuter depuis /v2/imports (aperçu disponible).");
}
