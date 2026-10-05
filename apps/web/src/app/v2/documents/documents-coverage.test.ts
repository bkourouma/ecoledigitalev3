import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  DOCUMENT_CONFIDENTIALITIES,
  DOCUMENT_HISTORY_ACTIONS,
  DOCUMENT_KINDS,
  DOCUMENT_OWNER_TYPES,
  DOCUMENT_QUARANTINE_STATUSES,
  DOCUMENT_SHARE_LEVELS,
  DOCUMENT_TEXT_INDEX_ERRORS,
  DOCUMENT_TEXT_INDEX_STATUSES,
  DOCUMENT_VISIBILITIES,
} from "@ecoledigitale/contracts/v2/documents";

/**
 * Filet de sécurité i18n de la gestion documentaire : toute clé passée à `t("…")` par les écrans `/v2/documents` et par les
 * composants partagés (`UploadDropzone`, `DocumentPicker`) existe dans `messages/fr-CI.json` ; les clés calculées sont couvertes
 * par les énumérations des contrats.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [path.join(ROOT, "app/v2/documents"), path.join(ROOT, "platform/ui/UploadDropzone.tsx"), path.join(ROOT, "platform/ui/DocumentPicker.tsx")];

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

describe("messages fr-CI : gestion documentaire", () => {
  it("les sources de la section existent (le test ne passe pas à vide)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(15);
  });

  it("toutes les clés statiques utilisées par les écrans et composants existent", () => {
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
    const need: Array<[string, readonly string[]]> = [
      ["v2Documents.kind", DOCUMENT_KINDS],
      ["v2Documents.confidentiality", DOCUMENT_CONFIDENTIALITIES],
      ["v2Documents.visibility", DOCUMENT_VISIBILITIES],
      ["v2Documents.ownerType", DOCUMENT_OWNER_TYPES],
      ["v2Documents.scope", ["all", "mine", "shared", "child", "self", "own"]],
      ["v2Documents.explorer.expiryOptions", ["any", "expiring", "expired", "dated", "missing"]],
      ["v2Documents.explorer.statusOptions", ["ACTIVE", "ARCHIVED", "ALL"]],
      ["v2Documents.upload.ownerTypes", DOCUMENT_OWNER_TYPES],
      ["v2Documents.upload.visibilities", DOCUMENT_VISIBILITIES],
      ["v2Documents.edit.visibilities", DOCUMENT_VISIBILITIES],
      ["v2Documents.shares.levels", DOCUMENT_SHARE_LEVELS],
      ["v2Documents.history.actions", DOCUMENT_HISTORY_ACTIONS],
      ["v2Documents.expirations.tab", ["expiring", "expired", "missing"]],
      ["v2Documents.expirations.empty", ["expiring", "expired", "missing"]],
      ["v2Documents.categories.kinds", DOCUMENT_KINDS],
      ["v2Documents.categories.levels", DOCUMENT_CONFIDENTIALITIES],
      ["v2Documents.categories.form.kinds", DOCUMENT_KINDS],
      ["v2Documents.categories.form.levels", DOCUMENT_CONFIDENTIALITIES],
      ["v2Documents.categories.grants.levels", DOCUMENT_SHARE_LEVELS],
      ["v2Documents.quarantine.status", [...DOCUMENT_QUARANTINE_STATUSES, "ALL"]],
      ["v2Documents.textIndex.status", DOCUMENT_TEXT_INDEX_STATUSES],
      ["v2Documents.textAdmin.counts", DOCUMENT_TEXT_INDEX_STATUSES],
      ["v2Documents.textIndex.errors", DOCUMENT_TEXT_INDEX_ERRORS],
      ["v2Documents.textAdmin.errors", DOCUMENT_TEXT_INDEX_ERRORS],
    ];
    const missing: string[] = [];
    for (const [ns, keys] of need) for (const key of keys) if (typeof lookup(ns, key) !== "string") missing.push(`${ns}.${key}`);
    expect(missing).toEqual([]);
  });
});
