import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  ASSIGNMENT_DOCUMENT_KINDS,
  ASSIGNMENT_SOURCES,
  ASSIGNMENT_STATUSES,
  CONTROL_KINDS,
  CONTROL_STATUSES,
  EXPORT_DATASETS,
  RECEIVABLE_AGING_BUCKETS,
  RECEIVABLE_STATUSES,
  RECONCILIATION_STATUSES,
} from "@ecoledigitale/contracts/v2/stateassign";
import { PERM } from "./_components/permissions";

/**
 * Filet de sécurité i18n des écrans « élèves affectés par l'État » : toute clé passée à `t("…")` existe dans `messages/fr-CI.json` ;
 * les clés calculées sont couvertes par les énumérations des contrats ; les permissions de l'écran sont celles du manifeste.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [path.join(ROOT, "app/v2/stateassign")];

function walk(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(target, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) && !full.includes("_test") ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

const FILES = SOURCES.flatMap(walk);

describe("messages fr-CI : élèves affectés par l'État", () => {
  it("les sources de la section existent (le test ne passe pas à vide)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(18);
  });

  it("toutes les clés statiques utilisées par les écrans existent", () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it("les clés calculées sont couvertes par les énumérations des contrats", () => {
    const endLike = ["title", "description", "submit", "done", "endedOn", "reason", "errors.date", "errors.reason", "button"];
    const need: Array<[string, readonly string[]]> = [
      ["v2Stateassign.status", ASSIGNMENT_STATUSES],
      ["v2Stateassign.source", ASSIGNMENT_SOURCES],
      ["v2Stateassign.reconciliation", RECONCILIATION_STATUSES],
      ["v2Stateassign.receivableStatus", RECEIVABLE_STATUSES],
      ["v2Stateassign.controlStatus", CONTROL_STATUSES],
      ["v2Stateassign.controlKind", CONTROL_KINDS],
      ["v2Stateassign.documentKind", ASSIGNMENT_DOCUMENT_KINDS],
      ["v2Stateassign.agingBucket", RECEIVABLE_AGING_BUCKETS],
      ["v2Stateassign.dataset", EXPORT_DATASETS],
      ["v2Stateassign.documents.status", ["ACTIVE", "WITHDRAWN"]],
      ["v2Stateassign.detail.history.actions", ["CREATED", "STATUS_CHANGED", "RECONCILED", "LINKED"]],
      ["v2Stateassign.detail.history.actors", ["user", "system", "superAdmin", "unknown"]],
      ["v2Stateassign.receivables.history.actions", ["CREATED", "RESCHEDULED", "AMOUNT_CHANGED", "RECEIVED_UPDATED", "STATUS_CHANGED", "OVERDUE_FLAGGED", "CANCELLED"]],
      ["v2Stateassign.receivables.history.actor", ["user", "system", "superAdmin", "unknown"]],
      ["v2Stateassign.actions.end", endLike],
      ["v2Stateassign.actions.transfer", endLike],
      ["v2Stateassign.actions.activate", ["done"]],
      ["v2Stateassign.actions.resume", ["done"]],
      ["v2Stateassign.controls.complete.outcomes", ["OK", "ANOMALY"]],
      ["v2Stateassign.settingsScreen.formats.form.delimiters", ["semicolon", "comma", "tab"]],
    ];
    const missing: string[] = [];
    for (const [ns, keys] of need) for (const key of keys) if (typeof lookup(ns, key) !== "string") missing.push(`${ns}.${key}`);
    expect(missing).toEqual([]);
  });

  it("les permissions de l'écran sont préfixées par le module et sans doublon (le manifeste de l'API est vérifié par ses propres tests)", () => {
    const keys = Object.values(PERM);
    for (const key of keys) expect(key.startsWith("stateassign."), key).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
