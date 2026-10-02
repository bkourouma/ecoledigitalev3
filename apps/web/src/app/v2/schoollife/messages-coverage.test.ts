import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  SCHOOLLIFE_APPEAL_STATUSES,
  SCHOOLLIFE_CONFIDENTIALITY_LEVELS,
  SCHOOLLIFE_CONVOCATION_REASONS,
  SCHOOLLIFE_CONVOCATION_STATUSES,
  SCHOOLLIFE_EFFECT_STATUSES,
  SCHOOLLIFE_INCIDENT_STATUSES,
  SCHOOLLIFE_INVOLVEMENT_ROLES,
  SCHOOLLIFE_KINDS,
  SCHOOLLIFE_MEASURE_STATUSES,
  SCHOOLLIFE_MOVEMENT_SOURCES,
  SCHOOLLIFE_NOTE_VISIBILITIES,
  SCHOOLLIFE_RESET_SCOPES,
  SCHOOLLIFE_SCALE_SOURCES,
  SCHOOLLIFE_SCALE_STATUSES,
} from "@ecoledigitale/contracts/v2/schoollife";

/**
 * Filet de sécurité i18n de la vie scolaire : toute clé statique passée à `t("…")` existe dans `messages/fr-CI.json`, et chaque
 * valeur d'énumération affichée a sa traduction (les clés calculées ne sont pas vues par l'analyse statique, d'où les listes).
 */
const ROOT = path.resolve(__dirname, "../..");
const SOURCES = [path.join(ROOT, "app/v2/schoollife")];

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

describe("messages fr-CI : vie scolaire", () => {
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
      ["v2Schoollife.status", [...SCHOOLLIFE_INCIDENT_STATUSES, ...SCHOOLLIFE_MEASURE_STATUSES, ...SCHOOLLIFE_APPEAL_STATUSES, ...SCHOOLLIFE_CONVOCATION_STATUSES, ...SCHOOLLIFE_EFFECT_STATUSES, ...SCHOOLLIFE_SCALE_STATUSES, "ACTIVE", "WITHDRAWN"]],
      ["v2Schoollife.kind", SCHOOLLIFE_KINDS],
      ["v2Schoollife.confidentiality", SCHOOLLIFE_CONFIDENTIALITY_LEVELS],
      ["v2Schoollife.role", SCHOOLLIFE_INVOLVEMENT_ROLES],
      ["v2Schoollife.visibility", SCHOOLLIFE_NOTE_VISIBILITIES],
      ["v2Schoollife.reasonKind", SCHOOLLIFE_CONVOCATION_REASONS],
      ["v2Schoollife.channel", ["IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"]],
      ["v2Schoollife.dashboard.cards", ["openIncidents", "measuresToValidate", "activeExclusions", "convocationsToHold", "effectsAwaitingHuman"]],
      ["v2Schoollife.note.title", ["ENCOURAGEMENT", "OBSERVATION"]],
      ["v2Schoollife.note.description", ["ENCOURAGEMENT", "OBSERVATION"]],
      ["v2Schoollife.convocation.outcome.hold", ["title", "confirm"]],
      ["v2Schoollife.convocation.outcome.no-show", ["title", "confirm"]],
      ...(["validate", "reject", "cancel", "revoke"] as const).map((k): [string, readonly string[]] => [`v2Schoollife.validations.dialogs.${k}`, ["title", "description", "label", "confirm"]]),
      ...(["uphold", "overturn"] as const).map((k): [string, readonly string[]] => [`v2Schoollife.validations.dialogs.${k}`, ["title", "description", "confirm"]]),
      ["v2Schoollife.validations.dialogs.appeal", ["label"]],
      ["v2Schoollife.validations.dialogs.skip", ["title", "description", "label", "confirm"]],
      ["v2Schoollife.validations.dialogs.apply", ["title", "description", "confirm", "status", "statusHint", "SUSPENDED", "EXCLUDED"]],
      ["v2Schoollife.validations.done", ["validated", "rejected", "cancelled", "revoked", "notified", "executed", "decided", "skipped", "applied"]],
      ["v2Schoollife.convocation.done", ["created", "sent", "held", "missed", "cancelled", "rescheduled"]],
      ["v2Schoollife.quick.saved", ["incident", "encouragement", "observation"]],
      ["v2Schoollife.file.done", ["incident", "encouragement", "observation", "measure", "convocation", "adjusted"]],
      ["v2Schoollife.file.clearanceLevel", SCHOOLLIFE_CONFIDENTIALITY_LEVELS],
      ["v2Schoollife.file.clearanceHint", SCHOOLLIFE_CONFIDENTIALITY_LEVELS],
      ["v2Schoollife.file.timeline.type", ["INCIDENT", "MEASURE", "NOTE", "CONVOCATION"]],
      ["v2Schoollife.file.timeline.confidentiality", SCHOOLLIFE_CONFIDENTIALITY_LEVELS],
      ["v2Schoollife.file.timeline.appealStatus", SCHOOLLIFE_APPEAL_STATUSES],
      ["v2Schoollife.file.timeline.visibility", SCHOOLLIFE_NOTE_VISIBILITIES],
      ["v2Schoollife.file.timeline.involvementRole", SCHOOLLIFE_INVOLVEMENT_ROLES],
      ["v2Schoollife.file.conduct.source", SCHOOLLIFE_MOVEMENT_SOURCES],
      ["v2Schoollife.file.history.entity", ["INCIDENT", "MEASURE", "NOTE", "CONVOCATION", "APPEAL", "SCALE"]],
      ["v2Schoollife.settings.types.flags.confidentiality", ["RESTRICTED", "CONFIDENTIAL"]],
      ["v2Schoollife.settings.scales.reset", SCHOOLLIFE_RESET_SCOPES],
      ["v2Schoollife.settings.scales.sourceKind", SCHOOLLIFE_SCALE_SOURCES],
      ["v2Schoollife.family.groups", ["MEASURE", "CONVOCATION", "NOTE"]],
      ["v2Schoollife.family.appealStatuses", SCHOOLLIFE_APPEAL_STATUSES],
    ];
    const missing: string[] = [];
    for (const [ns, keys] of expectations) for (const key of keys) if (typeof lookup(ns, key) !== "string") missing.push(`${ns}.${key}`);
    expect(missing).toEqual([]);
  });
});
