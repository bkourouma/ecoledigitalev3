import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  ADMISSION_CAMPAIGN_STATUSES,
  ADMISSION_CLOSURE_KINDS,
  ADMISSION_CONSENT_KINDS,
  ADMISSION_CONSENT_VIAS,
  ADMISSION_DECISION_KINDS,
  ADMISSION_DOCUMENT_STATUSES,
  ADMISSION_DUPLICATE_KINDS,
  ADMISSION_DUPLICATE_STATUSES,
  ADMISSION_FUNDING_TYPES,
  ADMISSION_INTERVIEW_KINDS,
  ADMISSION_INTERVIEW_RESULTS,
  ADMISSION_INTERVIEW_STATUSES,
  ADMISSION_OFFER_STATUSES,
  ADMISSION_CAPACITY_POLICIES,
  ADMISSION_DUPLICATE_POLICIES,
  ADMISSION_WAITLIST_PROMOTIONS,
  ADMISSION_PROSPECT_STATUSES,
  ADMISSION_STATUSES,
  ADMISSION_WORKFLOW_STATUSES,
} from "@ecoledigitale/contracts/v2/admissions";

/**
 * Filet de sécurité i18n des admissions : toute clé passée à `t("…")` par les écrans `/v2/admissions` et `/v2/apply` existe dans
 * `messages/fr-CI.json` ; les clés calculées sont couvertes par les énumérations des contrats.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = [path.join(ROOT, "app/v2/admissions"), path.join(ROOT, "app/v2/apply")];

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

describe("messages fr-CI : admissions", () => {
  it("les sources des écrans existent (le test ne passe pas à vide)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(25);
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
    const need: Array<[string, readonly string[]]> = [
      ["v2Admissions.status", ADMISSION_STATUSES],
      ["v2Admissions.closureKind", ADMISSION_CLOSURE_KINDS],
      ["v2Admissions.decisionKind", ADMISSION_DECISION_KINDS],
      ["v2Admissions.funding", ADMISSION_FUNDING_TYPES],
      ["v2Admissions.workflowStatus", ADMISSION_WORKFLOW_STATUSES],
      ["v2Admissions.campaignStatus", ADMISSION_CAMPAIGN_STATUSES],
      ["v2Admissions.prospectStatus", ADMISSION_PROSPECT_STATUSES],
      ["v2Admissions.documentStatus", ADMISSION_DOCUMENT_STATUSES],
      ["v2Admissions.interviewKind", ADMISSION_INTERVIEW_KINDS],
      ["v2Admissions.interviewStatus", ADMISSION_INTERVIEW_STATUSES],
      ["v2Admissions.interviews.result", ADMISSION_INTERVIEW_RESULTS],
      ["v2Admissions.offerStatus", ADMISSION_OFFER_STATUSES],
      ["v2Admissions.offers.notified", ["SENT", "QUEUED", "SKIPPED", "FAILED"]],
      ["v2Admissions.duplicateKind", ADMISSION_DUPLICATE_KINDS],
      ["v2Admissions.duplicateStatus", ADMISSION_DUPLICATE_STATUSES],
      ["v2Admissions.consentKind", ADMISSION_CONSENT_KINDS],
      ["v2Admissions.consentVia", ADMISSION_CONSENT_VIAS],
      ["v2Admissions.policy.capacity", ADMISSION_CAPACITY_POLICIES],
      ["v2Admissions.policy.duplicate", ADMISSION_DUPLICATE_POLICIES],
      ["v2Admissions.policy.promotion", ADMISSION_WAITLIST_PROMOTIONS],
      ["v2Admissions.prospects.sources", ["WALK_IN", "PHONE", "REFERRAL", "SOCIAL", "WEBSITE", "EVENT", "OTHER"]],
      ["v2Admissions.workflow.flags", ["isInitial", "isTerminal", "holdsSeat", "requiresConsent", "requiresDocumentsComplete", "requiresInterviewDone", "requiresDecision", "createsEnrollment"]],
      ["v2AdmissionsPublic.form.failure", ["closed", "tooMany", "unavailable", "invalid", "generic"]],
      ["v2AdmissionsPublic.form.unavailable", ["closed", "tooMany", "unavailable", "invalid", "generic"]],
      ["v2AdmissionsPublic.track.error", ["notFound", "tooMany", "unavailable"]],
      ["v2AdmissionsPublic.track.uploadError", ["invalid", "tooMany", "unavailable"]],
      ["v2AdmissionsPublic.offer.error", ["notFound", "tooMany", "unavailable"]],
      ["v2AdmissionsPublic.offer.closed", ["ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"]],
    ];
    const missing: string[] = [];
    for (const [ns, keys] of need) for (const key of keys) if (typeof lookup(ns, key) !== "string") missing.push(`${ns}.${key}`);
    expect(missing).toEqual([]);
  });

  it("aucun écran public n'utilise une clé du back-office, aucun message public ne cite d'effectif ni de doublon", () => {
    const publicMessages = JSON.stringify((catalog as unknown as Record<string, unknown>)["v2AdmissionsPublic"]).toLowerCase();
    for (const word of ["doublon", "places restantes", "places libres", "liste d'attente", "rang"]) expect(publicMessages).not.toContain(word);
    for (const file of FILES.filter((f) => f.includes(`${path.sep}apply${path.sep}`))) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/useTranslations\("v2Admissions\./);
      expect(source).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});
