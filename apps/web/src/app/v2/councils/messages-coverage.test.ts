import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  COUNCIL_AGENDA_STATUSES,
  COUNCIL_CONSENT_STATES,
  COUNCIL_DECISION_APPLIES_TO,
  COUNCIL_DECISION_FAMILIES,
  COUNCIL_DECISION_MODES,
  COUNCIL_DECISION_STATUSES,
  COUNCIL_EFFECT_KINDS,
  COUNCIL_EFFECT_STATUSES,
  COUNCIL_EFFECT_TRIGGERS,
  COUNCIL_FUNCTIONS,
  COUNCIL_GUARDIAN_VISIBILITIES,
  COUNCIL_MINUTES_STATUSES,
  COUNCIL_ORIENTATION_FILE_STATUSES,
  COUNCIL_ORIENTATION_PATH_KINDS,
  COUNCIL_PRESENCES,
  COUNCIL_PROPOSAL_KINDS,
  COUNCIL_PROPOSAL_ORIGINS,
  COUNCIL_PROPOSAL_STATUSES,
  COUNCIL_RENDER_STATUSES,
  COUNCIL_RESULTS_STATUSES,
  COUNCIL_RULE_SOURCE_KINDS,
  COUNCIL_SCOPES,
  COUNCIL_SIGNATURE_METHODS,
  COUNCIL_STATUSES,
  COUNCIL_TRANSFER_STATUSES,
  COUNCIL_UNLOCK_STATUSES,
  COUNCIL_WISH_SOURCES,
  COUNCILS_EVENT_TYPES,
} from "@ecoledigitale/contracts/v2/councils";

/**
 * Filet de sécurité i18n des conseils de classe : toute clé statique passée à `t("…")` existe dans `messages/fr-CI.json`, et
 * chaque valeur d'énumération affichée a sa traduction (les clés calculées échappent à l'analyse statique, d'où les listes).
 */
const ROOT = path.resolve(__dirname, "../..");
const SOURCES = [path.join(ROOT, "app/v2/councils")];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) && !full.includes("_test") ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI : conseils de classe", () => {
  it("toutes les clés statiques existent", () => {
    const missing: string[] = [];
    for (const file of SOURCES.flatMap(walk)) {
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

  it("les libellés d'énumération sont tous traduits", () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["v2Councils.enums.status", COUNCIL_STATUSES],
      ["v2Councils.enums.scope", COUNCIL_SCOPES],
      ["v2Councils.enums.presence", COUNCIL_PRESENCES],
      ["v2Councils.enums.function", COUNCIL_FUNCTIONS],
      ["v2Councils.enums.agendaStatus", COUNCIL_AGENDA_STATUSES],
      ["v2Councils.enums.proposalKind", COUNCIL_PROPOSAL_KINDS],
      ["v2Councils.enums.proposalStatus", COUNCIL_PROPOSAL_STATUSES],
      ["v2Councils.enums.origin", COUNCIL_PROPOSAL_ORIGINS],
      ["v2Councils.enums.decisionFamily", COUNCIL_DECISION_FAMILIES],
      ["v2Councils.enums.decisionMode", COUNCIL_DECISION_MODES],
      ["v2Councils.enums.decisionStatus", COUNCIL_DECISION_STATUSES],
      ["v2Councils.enums.effectKind", COUNCIL_EFFECT_KINDS],
      ["v2Councils.enums.effectStatus", COUNCIL_EFFECT_STATUSES],
      ["v2Councils.enums.minutesStatus", COUNCIL_MINUTES_STATUSES],
      ["v2Councils.enums.renderStatus", COUNCIL_RENDER_STATUSES],
      ["v2Councils.enums.signatureMethod", COUNCIL_SIGNATURE_METHODS],
      ["v2Councils.enums.unlockStatus", COUNCIL_UNLOCK_STATUSES],
      ["v2Councils.enums.resultsStatus", COUNCIL_RESULTS_STATUSES],
      ["v2Councils.enums.guardianVisibility", COUNCIL_GUARDIAN_VISIBILITIES],
      ["v2Councils.enums.effectsTrigger", COUNCIL_EFFECT_TRIGGERS],
      ["v2Councils.enums.appliesTo", COUNCIL_DECISION_APPLIES_TO],
      ["v2Councils.enums.pathKind", COUNCIL_ORIENTATION_PATH_KINDS],
      ["v2Councils.enums.orientationStatus", COUNCIL_ORIENTATION_FILE_STATUSES],
      ["v2Councils.enums.consent", COUNCIL_CONSENT_STATES],
      ["v2Councils.enums.wishSource", COUNCIL_WISH_SOURCES],
      ["v2Councils.enums.transferStatus", COUNCIL_TRANSFER_STATUSES],
      ["v2Councils.enums.effectiveKind", ["NEXT_YEAR", "MID_YEAR"]],
      ["v2Councils.enums.decidedVia", ["COUNCIL", "DIRECTOR_ACT"]],
      ["v2Councils.enums.ruleSource", COUNCIL_RULE_SOURCE_KINDS],
      ["v2Councils.enums.authorRole", ["TEACHER", "COUNCIL", "DIRECTOR"]],
      ["v2Councils.enums.proposedSource", ["HOMEROOM", "TEACHING"]],
      ["v2Councils.enums.studentStatus", ["SUSPENDED", "EXCLUDED"]],
      ["v2Councils.calendar.statusOptions", COUNCIL_STATUSES],
      ["v2Councils.history.events", COUNCILS_EVENT_TYPES.map((e) => e.replace(/^councils\./, "").replace(/\./g, "_"))],
      ["v2Councils.proposals.dialog.reject", ["title", "description", "confirm"]],
      ["v2Councils.proposals.dialog.withdraw", ["title", "description", "confirm"]],
      ["v2Councils.proposals.done", ["accepted", "rejected", "withdrawn", "added"]],
      ["v2Councils.unlock.approveDialog", ["title", "description", "label", "confirm"]],
      ["v2Councils.unlock.rejectDialog", ["title", "description", "label", "confirm"]],
      ["v2Councils.effects.dialogs.skip", ["title", "description", "label", "confirm"]],
      ["v2Councils.effects.dialogs.revert", ["title", "description", "label", "confirm"]],
      ["v2Councils.effects.done", ["retried", "applied", "skipped", "reverted"]],
      ["v2Councils.orientation.done", ["pathSaved", "fileCreated", "transferCreated", "transferCancelled", "transferApplied", "consentGiven", "consentRefused"]],
      ["v2Councils.errors.codes", ["not_found", "quorum_not_met", "invalid_status", "minutes_not_rendered", "justification_required"]],
    ];
    const missing: string[] = [];
    for (const [ns, keys] of expectations) for (const key of keys) if (typeof lookup(ns, key) !== "string") missing.push(`${ns}.${key}`);
    expect(missing).toEqual([]);
  });

  it("le bloc v2Councils ne contient aucun libellé vide", () => {
    const empty: string[] = [];
    const walkObj = (node: unknown, trail: string) => {
      if (typeof node === "string") {
        if (node.trim() === "") empty.push(trail);
      } else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walkObj(v, `${trail}.${k}`);
    };
    walkObj((catalog as Record<string, unknown>).v2Councils, "v2Councils");
    expect(empty).toEqual([]);
  });
});
