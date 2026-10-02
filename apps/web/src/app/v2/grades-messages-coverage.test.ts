import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../messages/fr-CI.json";
import { ASSESS_ENTRY_STATUSES, ASSESS_PUBLICATION_MODES, ASSESS_REVISION_KINDS, ASSESS_REVISION_STATUSES, ASSESS_STATUSES } from "@ecoledigitale/contracts/v2/assess";
import { RESULTS_LEVELS, RESULTS_OUTCOMES, RESULTS_PERIOD_STATUSES, RESULTS_RESULT_STATUSES } from "@ecoledigitale/contracts/v2/results";
import { RULES_RULE_TYPES, RULES_STATUSES } from "@ecoledigitale/contracts/v2/rules";
import { REPORTCARDS_BATCH_OUTCOMES, REPORTCARDS_BATCH_STATUSES, REPORTCARDS_PACKS, REPORTCARDS_RENDER_STATUSES, REPORTCARDS_STATUSES, REPORTCARDS_TEMPLATE_DOCUMENT_KINDS, REPORTCARDS_VERIFICATION_STATUSES } from "@ecoledigitale/contracts/v2/reportcards";
import { HIGHER_ACQUIRED_VIA, HIGHER_AWARD_STATUSES, HIGHER_AWARDED_VIA, HIGHER_DIPLOMA_STATUSES, HIGHER_DOCUMENT_KINDS, HIGHER_DOCUMENT_STATUSES, HIGHER_LEDGER_STATUSES, HIGHER_RESIT_PHASES, HIGHER_RESIT_REGISTRATION_STATUSES, HIGHER_RESIT_WINDOW_STATUSES, HIGHER_SLOT_KEYS } from "@ecoledigitale/contracts/v2/higher";

/**
 * Filet de sécurité i18n des écrans « notes, résultats, règles, bulletins, supérieur » (`v2Assess*`, `v2Results*`,
 * `v2Rules*`, `v2Reportcards*`, `v2Higher*`) : toute clé passée à `t("…")` existe dans `messages/fr-CI.json` ; les clés
 * calculées (`t(\`done.${x}\`)`) sont couvertes par les énumérations des contrats vérifiées ci-dessous.
 */

const ROOT = path.resolve(__dirname, "../..");
const SECTIONS = ["assessments", "results", "rules", "reportcards", "verify", "higher"];
const SOURCES = SECTIONS.map((s) => path.join(ROOT, "app/v2", s));
const OWN_NAMESPACE = /^v2(Assess|Results|Rules|Reportcards|Higher)/;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI (notes, résultats, règles, bulletins, supérieur)", () => {
  it("toutes les clés statiques utilisées existent", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of SOURCES.flatMap(walk)) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          checked += 1;
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
        // Clés calculées : le préfixe doit désigner un groupe non vide.
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*` + "`" + String.raw`([^$` + "`" + String.raw`]*)\$\{`, "g"))) {
          const prefix = m[1]!.replace(/\.$/, "");
          const group = prefix ? lookup(d.ns, prefix) : (d.ns.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown>)?.[p], catalog));
          if (!group || typeof group !== "object" || Object.keys(group as object).length === 0) missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}\${…}`);
        }
      });
    }
    expect(missing).toEqual([]);
    // Garde-fou du test lui-même : l'extraction trouve bien des clés (sinon un échec d'analyse passerait inaperçu).
    expect(checked).toBeGreaterThan(100);
  });

  it("aucune valeur de nos espaces de noms n'est vide", () => {
    const empty: string[] = [];
    const visit = (value: unknown, trail: string) => {
      if (typeof value === "string") {
        if (value.trim() === "") empty.push(trail);
      } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, `${trail}.${k}`);
    };
    for (const [ns, tree] of Object.entries(catalog)) if (OWN_NAMESPACE.test(ns)) visit(tree, ns);
    expect(empty).toEqual([]);
  });

  it("les états des contrats d'évaluation ont tous un libellé", () => {
    const a = (catalog as unknown as { v2Assess: Record<string, Record<string, string>> }).v2Assess;
    for (const s of ASSESS_STATUSES) expect(a.status![s], `status.${s}`).toBeTruthy();
    for (const s of ASSESS_ENTRY_STATUSES) expect(a.entryStatus![s], `entryStatus.${s}`).toBeTruthy();
    for (const s of ASSESS_REVISION_STATUSES) expect(a.revisionStatus![s], `revisionStatus.${s}`).toBeTruthy();
    for (const s of ASSESS_REVISION_KINDS) expect(a.revisionKind![s], `revisionKind.${s}`).toBeTruthy();
    for (const s of ASSESS_PUBLICATION_MODES) expect(a.publicationMode![s], `publicationMode.${s}`).toBeTruthy();
  });

  it("les énumérations des contrats de résultats, règles, bulletins et supérieur ont toutes un libellé", () => {
    const ns = catalog as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const expectAll = (namespace: string, group: string, values: ReadonlyArray<string>) => {
      for (const v of values) expect(ns[namespace]?.[group]?.[v], `${namespace}.${group}.${v}`).toBeTruthy();
    };
    expectAll("v2Results", "periodStatus", RESULTS_PERIOD_STATUSES);
    expectAll("v2Results", "resultStatus", RESULTS_RESULT_STATUSES);
    expectAll("v2Results", "outcome", RESULTS_OUTCOMES);
    expectAll("v2Results", "levels", RESULTS_LEVELS);
    expectAll("v2Rules", "status", RULES_STATUSES);
    expectAll("v2Rules", "ruleType", RULES_RULE_TYPES);
    expectAll("v2Reportcards", "status", REPORTCARDS_STATUSES);
    expectAll("v2Reportcards", "renderStatus", REPORTCARDS_RENDER_STATUSES);
    expectAll("v2Reportcards", "batchStatus", REPORTCARDS_BATCH_STATUSES);
    expectAll("v2Reportcards", "batchOutcome", REPORTCARDS_BATCH_OUTCOMES);
    expectAll("v2Reportcards", "pack", REPORTCARDS_PACKS);
    expectAll("v2ReportcardsVerify", "status", REPORTCARDS_VERIFICATION_STATUSES);
    expectAll("v2ReportcardsVerify", "kind", REPORTCARDS_TEMPLATE_DOCUMENT_KINDS);
    expectAll("v2Higher", "diplomaStatus", HIGHER_DIPLOMA_STATUSES);
    expectAll("v2Higher", "awardStatus", HIGHER_AWARD_STATUSES);
    expectAll("v2Higher", "awardedVia", HIGHER_AWARDED_VIA);
    expectAll("v2Higher", "documentKind", HIGHER_DOCUMENT_KINDS);
    expectAll("v2Higher", "documentStatus", HIGHER_DOCUMENT_STATUSES);
    expectAll("v2Higher", "acquiredVia", HIGHER_ACQUIRED_VIA);
    expectAll("v2Higher", "ledgerStatus", HIGHER_LEDGER_STATUSES);
    expectAll("v2Higher", "resitPhase", HIGHER_RESIT_PHASES);
    expectAll("v2Higher", "resitWindowStatus", HIGHER_RESIT_WINDOW_STATUSES);
    expectAll("v2Higher", "resitRegistrationStatus", HIGHER_RESIT_REGISTRATION_STATUSES);
    expectAll("v2Higher", "slotKey", HIGHER_SLOT_KEYS);
    expectAll("v2Results", "decisionStatus", ["PROPOSED", "CONFIRMED", "PUBLISHED", "WITHDRAWN"]);
    expectAll("v2Results", "overrideStatus", ["REQUESTED", "APPROVED", "REJECTED", "REVOKED"]);
    expectAll("v2Results", "deliberationStatus", ["PLANNED", "HELD", "SIGNED", "CANCELLED"]);
    expectAll("v2Rules", "simulationStatus", ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
    expectAll("v2Higher", "debtStatus", ["OPEN", "CLEARED"]);
  });
});
