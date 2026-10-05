import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  MESSAGING_ANNOUNCEMENT_STATUSES,
  MESSAGING_AUDIENCES,
  MESSAGING_CLASS_INCLUDES,
  MESSAGING_EXTERNAL_CHANNELS,
  MESSAGING_NOTIFICATION_CATEGORIES,
  MESSAGING_PRIORITIES,
  MESSAGING_REPORT_REASONS,
  MESSAGING_REPORT_STATUSES,
  MESSAGING_STUDENT_POLICIES,
  MESSAGING_TARGET_KINDS,
} from "@ecoledigitale/contracts/v2/messaging";

/**
 * Filet de sécurité i18n de la messagerie et des annonces (`v2Messaging*`) : toute clé passée à `t("…")` existe dans
 * `messages/fr-CI.json` ; les clés calculées (`t(\`priority.${x}\`)`) sont couvertes par les énumérations des contrats.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [path.join(ROOT, "app/v2/messages"), path.join(ROOT, "app/v2/announcements")];

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

describe("messages fr-CI : messagerie et annonces", () => {
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
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it("les libellés d'énumération sont tous traduits", () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["v2Messaging.priority", MESSAGING_PRIORITIES],
      ["v2Messaging.report.reasons", MESSAGING_REPORT_REASONS],
      ["v2Messaging.compose.includes", MESSAGING_CLASS_INCLUDES],
      ["v2Messaging.compose.audience", MESSAGING_AUDIENCES],
      ["v2Messaging.compose.kinds", ["DIRECT", "GROUP", "BROADCAST"]],
      ["v2Messaging.compose.kindHints", ["DIRECT", "GROUP", "BROADCAST"]],
      ["v2Messaging.inbox.folder", ["inbox", "starred", "archived", "sent"]],
      ["v2Messaging.inbox.empty", ["inbox", "starred", "archived", "sent"]],
      ["v2Messaging.notifications.categories", MESSAGING_NOTIFICATION_CATEGORIES],
      ["v2Messaging.notifications.channels", MESSAGING_EXTERNAL_CHANNELS],
      ["v2MessagingAnnouncements.status", MESSAGING_ANNOUNCEMENT_STATUSES],
      ["v2MessagingAnnouncements.targets", MESSAGING_TARGET_KINDS],
      ["v2MessagingAnnouncements.audiences", MESSAGING_AUDIENCES],
      ["v2MessagingAnnouncements.scope", ["inbox", "managed"]],
      ["v2MessagingAnnouncements.receipts.states", ["all", "unread", "read", "acknowledged", "pending_ack"]],
      ["v2MessagingModeration.reasons", MESSAGING_REPORT_REASONS],
      ["v2MessagingModeration.status", MESSAGING_REPORT_STATUSES],
      ["v2MessagingModeration.tabs", ["reports", "restrictions", "supervision"]],
      ["v2MessagingSettings.policies", MESSAGING_STUDENT_POLICIES],
      ["v2MessagingSettings.mime", ["application_pdf", "image_jpeg", "image_png", "image_webp"]],
      ["v2MessagingSettings.numbers", ["maxMessagesPerHour", "maxNewConversationsPerDay", "maxGroupParticipants", "maxBroadcastParticipants", "messageMaxLength", "attachmentMaxPerItem", "notificationRetentionDays", "previousYearWindowDays"]],
      ["v2MessagingSettings.templates.names", ["attendance.absence", "attendance.late"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) for (const v of values) if (typeof lookup(ns, v) !== "string") missing.push(`${ns}.${v}`);
    expect(missing).toEqual([]);
  });
});
