import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  NOTIF_AUDIENCE_KINDS,
  NOTIF_CATEGORIES,
  NOTIF_CHANNELS,
  NOTIF_CHANNEL_STATES,
  NOTIF_CONSENT_MODELS,
  NOTIF_DELIVERY_STATUSES,
  NOTIF_SKIP_REASONS,
  NOTIF_SOURCE_KINDS,
  NOTIF_STRATEGIES,
} from "@ecoledigitale/contracts/v2/notifications";

/**
 * Filet de sécurité i18n des notifications (`v2Notifications*`) : toute clé passée à `t("…")` existe dans
 * `messages/fr-CI.json` ; les clés calculées (`t(\`status.${x}\`)`) sont couvertes par les énumérations des contrats.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [path.join(ROOT, "app/v2/notifications"), path.join(ROOT, "app/v2/account")];

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

describe("messages fr-CI : notifications", () => {
  it("toutes les clés statiques utilisées par les écrans existent", () => {
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
      });
    }
    expect(checked).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });

  it("les libellés d'énumération sont tous traduits", () => {
    const channels = ["v2Notifications.channels", "v2NotificationsTemplates.channelNames", "v2NotificationsRules.channels", "v2NotificationsChannels.names", "v2NotificationsChannels.settings.channels", "v2NotificationsSend.channels", "v2NotificationsAccount.channels", "v2NotificationsUnsubscribe.channels"];
    const categories = ["v2Notifications.categories", "v2NotificationsAccount.categories"];
    const includes = ["GUARDIANS", "STUDENTS", "TEACHERS"];
    const expectations: Array<[string, readonly string[]]> = [
      ...channels.map((ns): [string, readonly string[]] => [ns, NOTIF_CHANNELS]),
      ...categories.map((ns): [string, readonly string[]] => [ns, NOTIF_CATEGORIES]),
      ["v2Notifications.status", NOTIF_DELIVERY_STATUSES],
      ["v2Notifications.skip", NOTIF_SKIP_REASONS],
      ["v2Notifications.source", NOTIF_SOURCE_KINDS],
      ["v2NotificationsChannels.states", NOTIF_CHANNEL_STATES],
      ["v2NotificationsChannels.settings.models", NOTIF_CONSENT_MODELS],
      ["v2NotificationsRules.audiences", NOTIF_AUDIENCE_KINDS],
      ["v2NotificationsRules.strategies", NOTIF_STRATEGIES],
      ["v2NotificationsSend.strategies", NOTIF_STRATEGIES],
      ["v2NotificationsRules.kinds", ["EVENT", "ALERT", "DUNNING"]],
      ["v2NotificationsRules.kindHints", ["EVENT", "ALERT", "DUNNING"]],
      ["v2NotificationsRules.alertTriggers", ["dunning", "OVERDUE_DAYS", "GRADE_DROP", "TEACHING_LOAD"]],
      ["v2NotificationsRules.priorities", ["LOW", "NORMAL", "HIGH", "URGENT"]],
      ["v2NotificationsRules.includes", includes],
      ["v2NotificationsSend.includes", includes],
      ["v2NotificationsRules.conditions", ["stages", "minDaysOverdue", "minDrop", "maxHours", "minValue", "priorities", "daysBefore"]],
      ["v2NotificationsRules.conditionHints", ["stages", "minDaysOverdue", "minDrop", "maxHours", "minValue", "daysBefore"]],
      ["v2NotificationsRules.errors", ["channels", "roles", "include", "stages", "stagesOrder", "number"]],
      ["v2NotificationsSend.audiences", ["STUDENT_GUARDIANS", "CLASSROOM", "ROLES"]],
      ["v2NotificationsSend.confirm.audience", ["STUDENT_GUARDIANS", "CLASSROOM", "ROLES"]],
      ["v2NotificationsAccount.push.failures", ["unsupported", "denied", "failed"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) for (const v of values) if (typeof lookup(ns, v) !== "string") missing.push(`${ns}.${v}`);
    expect(missing).toEqual([]);
  });
});
