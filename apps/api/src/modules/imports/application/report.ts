/**
 * Étape 4 — ERREURS : tableau filtrable par ligne / colonne (`listImportRows`) et rapport téléchargeable (CSV ou XLSX,
 * valeurs NEUTRALISÉES contre l'injection de formule — INV-S7). Fichier modèle de chaque importeur.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ImportListRowsQuery, ImportRowPage, ImporterKey } from "@ecoledigitale/contracts/src/v2/imports";
import { notFound } from "../domain/errors";
import type { RowRecord } from "../domain/records";
import { findImporter } from "../importers/registry";
import { listRows, reportPage } from "../infrastructure/rows-repository";
import { CSV_MIME, writeCsv, writeXlsx, XLSX_MIME, type Cell } from "../infrastructure/files/write";
import { inTx, type ImportsDeps } from "./deps";
import { loadVisibleJob, type Viewer } from "./jobs";
import { toRowDto } from "./views";

export async function listImportRows(deps: ImportsDeps, ctx: RequestContext, id: string, query: ImportListRowsQuery, viewer: Viewer): Promise<Result<ImportRowPage, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadVisibleJob(tx, ctx, id, viewer);
      if (!loaded.ok) return loaded;
      const page = await listRows(tx, id, { validation: query.validation, action: query.action, outcome: query.outcome, onlyProblems: query.onlyProblems, column: query.column, code: query.code, rowNo: query.rowNo, limit: query.limit, offset: query.offset });
      return ok({ items: page.items.map(toRowDto), total: page.total, limit: query.limit, offset: query.offset });
    },
    { readOnly: true },
  );
}

export interface DownloadFile {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

const STATUS_FR: Record<string, string> = { CREATED: "Créée", UPDATED: "Mise à jour", SKIPPED: "Ignorée", FAILED: "Refusée" };
const ACTION_FR: Record<string, string> = { CREATE: "À créer", UPDATE: "À mettre à jour", SKIP: "À ignorer", ERROR: "Refusée" };

/**
 * Rapport par ligne. `errors` : une ligne par problème (numéro, champ, code, message) ; `full` : toutes les lignes avec
 * leur résultat. Les cellules du fichier d'origine sont reprises (texte), neutralisées à l'écriture.
 */
export async function buildImportReportFile(deps: ImportsDeps, ctx: RequestContext, id: string, format: "csv" | "xlsx", kind: "errors" | "full", viewer: Viewer): Promise<Result<DownloadFile, AppError>> {
  const loaded = await deps.db.run(
    ctx,
    async (tx) => {
      const r = await loadVisibleJob(tx, ctx, id, viewer);
      if (!r.ok) return r;
      const rows: RowRecord[] = [];
      let after = 0;
      for (;;) {
        const page = await reportPage(tx, id, after, 1000, kind === "errors");
        if (page.length === 0) break;
        rows.push(...page);
        after = page[page.length - 1]?.rowNo ?? after;
      }
      return ok({ job: r.value, rows });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { job, rows } = loaded.value;
  const importer = findImporter(job.importerKey);
  const labelOf = (key: string | null): string => (key ? (importer?.columns.find((c) => c.key === key)?.label ?? key) : "");

  const table: Cell[][] = [];
  if (kind === "errors") {
    table.push(["Ligne", "Colonne du fichier", "Champ", "Gravité", "Code", "Message", ...job.headers]);
    for (const row of rows) {
      const all = [...row.issues, ...(row.outcomeIssues ?? [])].filter((i) => i.severity === "ERROR");
      const cells = (row.raw ?? []).map((c) => c ?? "");
      for (const i of all) table.push([row.rowNo, i.header ?? "", labelOf(i.column), "Erreur", i.code, i.message, ...cells]);
    }
  } else {
    table.push(["Ligne", "Validation", "Action prévue", "Résultat", "Identifiant créé", "Problèmes", ...job.headers]);
    for (const row of rows) {
      const problems = [...row.issues, ...(row.outcomeIssues ?? [])].map((i) => `${i.severity === "ERROR" ? "Erreur" : "Avertissement"} ${labelOf(i.column) ? `(${labelOf(i.column)}) ` : ""}${i.message} [${i.code}]`).join(" | ");
      table.push([row.rowNo, row.validation === "INVALID" ? "Invalide" : row.validation === "VALID" ? "Valide" : "En attente", row.plannedAction ? (ACTION_FR[row.plannedAction] ?? row.plannedAction) : "", row.outcome ? (STATUS_FR[row.outcome] ?? row.outcome) : "", row.entityId ?? "", problems, ...(row.raw ?? [])]);
    }
  }
  const base = job.fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "import";
  const name = `${base}-${kind === "errors" ? "erreurs" : "rapport"}`;
  if (format === "csv") return ok({ fileName: `${name}.csv`, contentType: CSV_MIME, bytes: writeCsv(table) });
  return ok({ fileName: `${name}.xlsx`, contentType: XLSX_MIME, bytes: await writeXlsx([{ name: kind === "errors" ? "Erreurs" : "Rapport", rows: table }]) });
}

/** Fichier modèle d'un importeur : en-têtes, lignes d'exemple fictives ; en XLSX, une feuille « Aide » décrit chaque champ. */
export async function buildTemplateFile(importerKey: ImporterKey, format: "csv" | "xlsx"): Promise<Result<DownloadFile, AppError>> {
  const importer = findImporter(importerKey);
  if (!importer) return err(notFound("imports.importer_unknown", "Importeur", importerKey));
  const head: Cell[] = importer.columns.map((c) => c.label + (c.required ? " *" : ""));
  const csvHead: Cell[] = importer.columns.map((c) => c.label);
  const name = `modele-import-${importer.key}`;
  if (format === "csv") return ok({ fileName: `${name}.csv`, contentType: CSV_MIME, bytes: writeCsv([csvHead, ...importer.sampleRows]) });
  const help: Cell[][] = [["Champ", "Obligatoire", "Type", "Description", "Exemple"], ...importer.columns.map((c) => [c.label, c.required ? "oui" : "non", c.type, c.description, c.example])];
  // En-têtes SANS astérisque dans la feuille de données : le fichier rempli se rapproche directement du mapping automatique.
  void head;
  return ok({ fileName: `${name}.xlsx`, contentType: XLSX_MIME, bytes: await writeXlsx([{ name: "Données", rows: [csvHead, ...importer.sampleRows] }, { name: "Aide", rows: help }]) });
}
