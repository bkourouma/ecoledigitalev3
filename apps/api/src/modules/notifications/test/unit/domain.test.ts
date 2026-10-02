import { describe, expect, it } from "vitest";
import { NOTIF_CATEGORIES } from "@ecoledigitale/contracts/src/v2/notifications";
import { addressHash, maskEmail, maskPhone, normalizeEmail, normalizePhone, scrubAddresses } from "../../domain/addresses";
import { detectGradeDrop, isOverloaded, monthKey, toNumber } from "../../domain/alerts";
import { attemptsExhausted, retryDelayMs } from "../../domain/backoff";
import { consentVerdict, decideEligibility, effectiveQuietWindow, quietUntil, type EligibilityInput } from "../../domain/consent";
import { DEFAULT_RULES } from "../../domain/default-rules";
import { dunningDedupeKey, nextStageToSend, planStages, daysBetween } from "../../domain/dunning";
import { conditionsMatch, readEvent, readInvoicePaid } from "../../domain/event-readers";
import { signBody, signUnsubscribeToken, verifyBodySignature, verifyUnsubscribeToken } from "../../domain/tokens";
import { localDateTime } from "../../domain/time";
import { SUPPORTED_TRIGGERS, triggerDef, validateRuleDef } from "../../domain/triggers";
import { DEFAULT_TENANT_SETTINGS, type RuleDef, type TenantSettings } from "../../domain/types";

const settings = (patch: Partial<TenantSettings> = {}): TenantSettings => ({ ...DEFAULT_TENANT_SETTINGS, ...patch });
const U1 = "0190aaaa-0000-7000-8000-000000000001";
const U2 = "0190aaaa-0000-7000-8000-000000000002";

describe("adresses : normalisation, masquage, empreinte", () => {
  it("normalise le numéro en E.164 comme le legacy (national, 00, +)", () => {
    expect(normalizePhone("07 07 07 07 07")).toBe("+2250707070707"); // Côte d'Ivoire : le 0 initial fait partie du numéro (plan 2021)
    expect(normalizePhone("0022507070707")).toBe("+22507070707");
    expect(normalizePhone("+225 07-07-07-07-07")).toBe("+2250707070707");
    expect(normalizePhone("0707070707", "221")).toBe("+221707070707"); // ailleurs : le 0 est un préfixe national
    expect(normalizePhone("07070707")).toBeNull(); // ancien plan à 8 chiffres : préfixe opérateur inconnu
    expect(normalizePhone("2250707070707")).toBe("+2250707070707");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("refuse un e-mail invalide ou contenant un retour à la ligne (injection d'en-tête)", () => {
    expect(normalizeEmail(" Awa.Kone@Gmail.com ")).toBe("awa.kone@gmail.com");
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a@b.co\nBcc: x@y.z")).toBeNull();
    expect(normalizeEmail("a b@c.dd")).toBeNull();
  });

  it("masque : jamais d'adresse complète", () => {
    expect(maskEmail("awa.kone@gmail.com")).toBe("a***@gmail.com");
    const m = maskPhone("+2250707070734");
    expect(m).toBe("+225 ** ** ** 34");
    expect(m).not.toContain("0707070");
  });

  it("scrubAddresses retire e-mails et numéros d'un message d'erreur de fournisseur", () => {
    const scrubbed = scrubAddresses("550 5.1.1 <awa.kone@gmail.com> unknown ; sms to +2250707070734 failed ; ref 2026-10-02");
    expect(scrubbed).not.toContain("awa.kone@gmail.com");
    expect(scrubbed).not.toContain("0707070734");
    expect(scrubbed).toContain("2026-10-02");
  });

  it("l'empreinte est stable, salée par établissement et par canal", () => {
    const a = addressHash("t1", "EMAIL", "x@y.zz");
    expect(a).toBe(addressHash("t1", "EMAIL", "x@y.zz"));
    expect(a).not.toBe(addressHash("t2", "EMAIL", "x@y.zz"));
    expect(a).not.toBe(addressHash("t1", "SMS", "x@y.zz"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("consentement et préférences", () => {
  const base = (patch: Partial<EligibilityInput> = {}): EligibilityInput => ({
    channel: "EMAIL",
    category: "FINANCE",
    urgent: false,
    settings: settings(),
    preferences: [],
    quiet: null,
    hasContact: true,
    suppressed: false,
    now: new Date("2026-10-02T12:00:00Z"),
    ...patch,
  });

  it("modèle IMPLIED : envoyé sauf refus ; modèle EXPLICIT : envoyé seulement si accordé", () => {
    expect(decideEligibility(base()).kind).toBe("SEND");
    const explicit = settings({ consentModels: { EMAIL: "EXPLICIT" } });
    expect(decideEligibility(base({ settings: explicit }))).toEqual({ kind: "SKIP", reason: "consent_revoked" });
    expect(decideEligibility(base({ settings: explicit, preferences: [{ channel: "EMAIL", category: "*", enabled: true }] })).kind).toBe("SEND");
  });

  it("opt-out du canal entier puis d'une catégorie ; la préférence la plus précise l'emporte", () => {
    const optOutAll = [{ channel: "EMAIL" as const, category: "*", enabled: false }];
    expect(decideEligibility(base({ preferences: optOutAll }))).toEqual({ kind: "SKIP", reason: "consent_revoked" });
    const optOutFinance = [{ channel: "EMAIL" as const, category: "FINANCE", enabled: false }];
    expect(decideEligibility(base({ preferences: optOutFinance }))).toEqual({ kind: "SKIP", reason: "category_opt_out" });
    expect(decideEligibility(base({ preferences: optOutFinance, category: "ATTENDANCE" })).kind).toBe("SEND");
    // canal refusé mais catégorie explicitement accordée : la catégorie est plus précise
    expect(decideEligibility(base({ preferences: [...optOutAll, { channel: "EMAIL", category: "FINANCE", enabled: true }] })).kind).toBe("SEND");
  });

  it("un refus sur UNE clé de la personne vaut pour toutes (consentement exprimé avant la création du compte)", () => {
    const rows = [
      { channel: "SMS" as const, category: "*", enabled: true },
      { channel: "SMS" as const, category: "*", enabled: false },
    ];
    expect(consentVerdict({ channel: "SMS", category: "FINANCE", urgent: false, settings: settings(), preferences: rows })).toEqual({ allowed: false, reason: "consent_revoked" });
  });

  it("l'URGENCE ignore le refus d'une catégorie, mais pas la révocation du canal (sauf décision de l'établissement)", () => {
    const optOutCategory = [{ channel: "SMS" as const, category: "URGENT", enabled: false }];
    expect(decideEligibility(base({ channel: "SMS", category: "URGENT", urgent: true, preferences: optOutCategory })).kind).toBe("SEND");
    const revoked = [{ channel: "SMS" as const, category: "*", enabled: false }];
    expect(decideEligibility(base({ channel: "SMS", category: "URGENT", urgent: true, preferences: revoked }))).toEqual({ kind: "SKIP", reason: "consent_revoked" });
    expect(decideEligibility(base({ channel: "SMS", category: "URGENT", urgent: true, preferences: revoked, settings: settings({ urgentBypassesRevocations: true }) })).kind).toBe("SEND");
  });

  it("une urgence n'invente jamais un consentement absent sous le modèle EXPLICIT", () => {
    const s = settings({ consentModels: { SMS: "EXPLICIT" }, urgentBypassesRevocations: true });
    expect(decideEligibility(base({ channel: "SMS", category: "URGENT", urgent: true, settings: s }))).toEqual({ kind: "SKIP", reason: "consent_revoked" });
  });

  it("la liste de suppression n'est JAMAIS contournée, même en urgence ; canal désactivé et absence de contact aussi", () => {
    expect(decideEligibility(base({ suppressed: true, urgent: true }))).toEqual({ kind: "SKIP", reason: "suppressed" });
    expect(decideEligibility(base({ hasContact: false }))).toEqual({ kind: "SKIP", reason: "no_contact" });
    expect(decideEligibility(base({ settings: settings({ enabledChannels: ["IN_APP"] }) }))).toEqual({ kind: "SKIP", reason: "channel_disabled" });
  });

  it("couvre toutes les catégories du contrat", () => {
    for (const category of NOTIF_CATEGORIES) expect(decideEligibility(base({ category })).kind).toBe("SEND");
  });
});

describe("heures calmes", () => {
  const night = new Date("2026-10-02T22:30:00Z"); // 22:30 à Abidjan (UTC+0)
  const s = settings();

  it("reporte un SMS de nuit à la fin de la plage (07:00 le lendemain) ; pas l'e-mail ni l'urgence", () => {
    const sms = decideEligibility({ channel: "SMS", category: "ATTENDANCE", urgent: false, settings: s, preferences: [], quiet: null, hasContact: true, suppressed: false, now: night });
    expect(sms).toMatchObject({ kind: "SEND", deferred: true });
    if (sms.kind === "SEND") expect(sms.availableAt.toISOString()).toBe("2026-10-03T07:00:00.000Z");
    const email = decideEligibility({ channel: "EMAIL", category: "ATTENDANCE", urgent: false, settings: s, preferences: [], quiet: null, hasContact: true, suppressed: false, now: night });
    expect(email).toMatchObject({ kind: "SEND", deferred: false });
    const urgent = decideEligibility({ channel: "SMS", category: "URGENT", urgent: true, settings: s, preferences: [], quiet: null, hasContact: true, suppressed: false, now: night });
    expect(urgent).toMatchObject({ kind: "SEND", deferred: false });
  });

  it("en journée : aucun report ; la plage à cheval sur minuit est gérée des deux côtés", () => {
    const w = effectiveQuietWindow(s, null);
    expect(quietUntil(new Date("2026-10-02T12:00:00Z"), w)).toBeNull();
    expect(quietUntil(new Date("2026-10-02T03:00:00Z"), w)?.toISOString()).toBe("2026-10-02T07:00:00.000Z");
    expect(quietUntil(new Date("2026-10-02T20:00:00Z"), w)?.toISOString()).toBe("2026-10-03T07:00:00.000Z");
    expect(quietUntil(new Date("2026-10-02T07:00:00Z"), w)).toBeNull();
  });

  it("la surcharge de la personne l'emporte sur l'établissement ; désactivées ou début = fin : aucun report", () => {
    const own = effectiveQuietWindow(s, { enabled: true, start: "13:00", end: "14:00" });
    expect(quietUntil(new Date("2026-10-02T13:30:00Z"), own)?.toISOString()).toBe("2026-10-02T14:00:00.000Z");
    expect(quietUntil(new Date("2026-10-02T22:30:00Z"), effectiveQuietWindow(s, { enabled: false, start: null, end: null }))).toBeNull();
    expect(quietUntil(new Date("2026-10-02T22:30:00Z"), { enabled: true, start: "08:00", end: "08:00", timeZone: "UTC" })).toBeNull();
  });

  it("tient compte du fuseau de l'établissement", () => {
    const paris = { ...effectiveQuietWindow(s, null), timeZone: "Europe/Paris" };
    // 22:30 UTC = 00:30 à Paris (été) : dans la plage, fin à 07:00 locale = 05:00 UTC
    expect(quietUntil(new Date("2026-07-01T22:30:00Z"), paris)?.toISOString()).toBe("2026-07-02T05:00:00.000Z");
  });
});

describe("relances : paliers", () => {
  it("seul le palier le plus haut atteint donne lieu à un envoi, tous sont consignés", () => {
    expect(planStages([3, 10, 30], 2)).toEqual({ target: null, reached: [] });
    expect(planStages([3, 10, 30], 3)).toEqual({ target: 3, reached: [3] });
    expect(planStages([3, 10, 30], 12)).toEqual({ target: 10, reached: [3, 10] });
    expect(planStages([30, 3, 10, 10], 45)).toEqual({ target: 30, reached: [3, 10, 30] });
  });

  it("jamais deux fois le même palier", () => {
    expect(nextStageToSend([3, 10, 30], 4, new Set())).toBe(3);
    expect(nextStageToSend([3, 10, 30], 4, new Set([3]))).toBeNull();
    expect(nextStageToSend([3, 10, 30], 11, new Set([3]))).toBe(10);
    expect(nextStageToSend([3, 10, 30], 11, new Set([3, 10]))).toBeNull();
    expect(dunningDedupeKey("i1", 10)).toBe("dunning:i1:10");
  });

  it("calcule les jours entre deux dates calendaires", () => {
    expect(daysBetween("2026-09-30", "2026-10-10")).toBe(10);
  });
});

describe("reprise avec backoff et alertes", () => {
  it("backoff exponentiel plafonné, avec gigue bornée", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(10)).toBe(3_600_000);
    expect(retryDelayMs(1, 0.5)).toBe(66_000);
    expect(retryDelayMs(1, 5)).toBeLessThan(72_001);
    expect(attemptsExhausted(5, 5)).toBe(true);
    expect(attemptsExhausted(4, 5)).toBe(false);
  });

  it("baisse de résultats : lue sur deux FINAL, comparée au seuil, jamais recalculée", () => {
    expect(detectGradeDrop("14.50", "10.5", 3)).toEqual({ previous: 14.5, current: 10.5, drop: 4 });
    expect(detectGradeDrop(14, 12, 3)).toBeNull();
    expect(detectGradeDrop(10, 14, 1)).toBeNull();
    expect(detectGradeDrop(null, 10, 1)).toBeNull();
    expect(detectGradeDrop("abc", 10, 1)).toBeNull();
    expect(toNumber("12,5")).toBe(12.5);
  });

  it("charge d'enseignement : au-delà du seuil, signalée une fois par mois", () => {
    expect(isOverloaded(25, 24)).toBe(true);
    expect(isOverloaded(24, 24)).toBe(false);
    expect(monthKey("2026-10-02")).toBe("2026-10");
  });
});

describe("jetons signés", () => {
  const claims = { tenantId: U1, subjectKey: `user:${U2}`, channel: "EMAIL" as const };

  it("le lien de désinscription se vérifie, et ne se falsifie pas", () => {
    const token = signUnsubscribeToken(claims, "secret-1");
    expect(verifyUnsubscribeToken(token, "secret-1")).toEqual(claims);
    expect(verifyUnsubscribeToken(token, "secret-2")).toBeNull();
    const [v, payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ t: U1, s: "user:autre", c: "EMAIL" })).toString("base64url");
    expect(verifyUnsubscribeToken(`${v}.${forged}.${sig}`, "secret-1")).toBeNull();
    expect(verifyUnsubscribeToken(`${v}.${payload}`, "secret-1")).toBeNull();
    expect(verifyUnsubscribeToken("n'importe quoi", "secret-1")).toBeNull();
  });

  it("la signature d'un corps d'accusé se vérifie à temps constant", () => {
    const body = JSON.stringify({ providerId: "p1", status: "DELIVERED" });
    expect(verifyBodySignature(body, signBody(body, "k"), "k")).toBe(true);
    expect(verifyBodySignature(body + " ", signBody(body, "k"), "k")).toBe(false);
    expect(verifyBodySignature(body, undefined, "k")).toBe(false);
    expect(verifyBodySignature(body, "sha256=00", "k")).toBe(false);
  });
});

describe("lecteurs d'événements", () => {
  const S = "0190aaaa-0000-7000-8000-0000000000aa";

  it("absence : ignore une absence excusée ou une correction, lit la date et le fait source", () => {
    expect(readEvent("attendance.absence.recorded", { v: 1, studentId: S, date: "2026-10-02", excused: true, correction: false, recordId: U1 })).toEqual({ kind: "skip", reason: "excused" });
    expect(readEvent("attendance.absence.recorded", { v: 1, studentId: S, date: "2026-10-02", excused: false, correction: true })).toEqual({ kind: "skip", reason: "correction" });
    const r = readEvent("attendance.absence.recorded", { v: 1, studentId: S, date: "2026-10-02", excused: false, correction: false, recordId: U1 });
    expect(r.kind === "facts" && r.facts.values).toEqual({ date: "2026-10-02" });
    expect(r.kind === "facts" && r.facts.dedupeId).toBe(U1);
  });

  it("facture émise : montant typé, échéance ; une facture d'un financeur ne notifie pas la famille", () => {
    const payload = { v: 1, invoiceId: U1, number: "FAC-1", learnerId: S, payerKind: "LEARNER", total: { amount: 150000, currency: "XOF" }, dueDate: "2026-10-31" };
    const r = readEvent("finance.invoice.issued", payload);
    expect(r.kind === "facts" && r.facts.values).toEqual({ invoiceNumber: "FAC-1", amount: { amount: 150000, currency: "XOF" }, dueDate: "2026-10-31" });
    expect(readEvent("finance.invoice.issued", { ...payload, payerKind: "FUNDER" })).toEqual({ kind: "skip", reason: "funder_invoice" });
    expect(readEvent("finance.invoice.issued", { ...payload, total: { amount: 1.5, currency: "XOF" } }).kind).toBe("unreadable");
  });

  it("un payload illisible est ignoré, jamais une exception", () => {
    for (const type of ["finance.payment.completed", "reportcards.report_card.published", "scheduling.occurrence.cancelled", "messaging.announcement.published", "people.staff_qualification.expiring", "payroll.payslip.notification_requested", "attendance.alert.triggered"]) {
      expect(readEvent(type, null).kind).toBe("unreadable");
      expect(readEvent(type, { v: 1 }).kind === "facts").toBe(false);
    }
    expect(readInvoicePaid({ invoiceId: U1 })).toEqual({ invoiceId: U1 });
    expect(readInvoicePaid({})).toBeNull();
  });

  it("alerte d'absences : seuil et indicateurs de la règle", () => {
    const rule = DEFAULT_RULES.find((r) => r.key === "attendance.absence_threshold")!;
    expect(conditionsMatch(rule, { metric: "ABSENT_COUNT", value: 3 })).toBe(true);
    expect(conditionsMatch(rule, { metric: "ABSENT_COUNT", value: 2 })).toBe(false);
    expect(conditionsMatch(rule, { metric: "LATE_COUNT", value: 9 })).toBe(false);
  });

  it("annonce : filtre sur la priorité ; document : préavis en jours", () => {
    const important = DEFAULT_RULES.find((r) => r.key === "messaging.announcement_important")!;
    const urgent = DEFAULT_RULES.find((r) => r.key === "messaging.announcement_urgent")!;
    expect(conditionsMatch(important, { priority: "HIGH" })).toBe(true);
    expect(conditionsMatch(important, { priority: "URGENT" })).toBe(false);
    expect(conditionsMatch(urgent, { priority: "URGENT" })).toBe(true);
    const doc = DEFAULT_RULES.find((r) => r.key === "people.document_expiring.hr")!;
    expect(conditionsMatch(doc, { daysLeft: 30 })).toBe(true);
    expect(conditionsMatch(doc, { daysLeft: 90 })).toBe(false);
  });

  it("annulation de cours : l'instant devient date et heure LOCALES de l'établissement", () => {
    expect(localDateTime("2026-10-05T08:00:00Z", "Africa/Abidjan")).toEqual({ date: "2026-10-05", time: "08:00" });
    expect(localDateTime("2026-10-05T23:30:00Z", "Europe/Paris")).toEqual({ date: "2026-10-06", time: "01:30" });
    expect(localDateTime("2026-10-05T08:00:00Z", "Fuseau/Inconnu")).toEqual({ date: "2026-10-05", time: "08:00" });
  });
});

describe("règles livrées et validation", () => {
  it("toutes les règles livrées sont valides (déclencheur, audience, gabarit dont les variables sont fournies)", () => {
    for (const rule of DEFAULT_RULES) expect(validateRuleDef(rule), rule.key).toEqual([]);
  });

  it("couvre événements, relances et alertes demandés", () => {
    const triggers = new Set(DEFAULT_RULES.map((r) => r.trigger));
    for (const t of ["finance.invoice.issued", "finance.invoice.overdue", "finance.payment.completed", "attendance.absence.recorded", "attendance.late.recorded", "reportcards.report_card.published", "scheduling.occurrence.cancelled", "messaging.announcement.published", "dunning", "OVERDUE_DAYS", "GRADE_DROP", "TEACHING_LOAD", "people.staff_qualification.expiring"]) {
      expect(triggers.has(t), t).toBe(true);
    }
    expect(DEFAULT_RULES.find((r) => r.key === "dunning.default")?.conditions.stages).toEqual([3, 10, 30]);
  });

  it("refuse un gabarit dont une variable obligatoire n'est pas fournie par le déclencheur", () => {
    const bad: Pick<RuleDef, "kind" | "trigger" | "templateCode" | "audience" | "channels" | "conditions"> = { kind: "EVENT", trigger: "attendance.absence.recorded", templateCode: "payment_received", audience: { kind: "STUDENT_GUARDIANS", financialFirst: false, fallbackToStudent: false }, channels: ["EMAIL"], conditions: {} };
    expect(validateRuleDef(bad).join(" ")).toMatch(/amount/);
  });

  it("refuse une audience incompatible, un gabarit interne adressé aux familles, des paliers non croissants, un seuil manquant", () => {
    const audience = { kind: "STUDENT_GUARDIANS", financialFirst: false, fallbackToStudent: false } as const;
    expect(validateRuleDef({ kind: "EVENT", trigger: "scheduling.occurrence.cancelled", templateCode: "schedule_change", audience, channels: ["EMAIL"], conditions: {} }).join(" ")).toMatch(/audience/i);
    expect(validateRuleDef({ kind: "ALERT", trigger: "OVERDUE_DAYS", templateCode: "overdue_staff_alert", audience, channels: ["EMAIL"], conditions: { minDaysOverdue: 10 } }).join(" ")).toMatch(/interne/);
    expect(validateRuleDef({ kind: "DUNNING", trigger: "dunning", templateCode: "payment_reminder", audience, channels: ["EMAIL"], conditions: { stages: [10, 3] } }).join(" ")).toMatch(/croissants/);
    expect(validateRuleDef({ kind: "ALERT", trigger: "TEACHING_LOAD", templateCode: "teaching_load_alert", audience: { kind: "ROLES", roleKeys: ["directeur_etudes"] }, channels: ["EMAIL"], conditions: {} }).join(" ")).toMatch(/maxHours/);
    expect(validateRuleDef({ kind: "EVENT", trigger: "inconnu.evt.fait", templateCode: "absence", audience, channels: ["EMAIL"], conditions: {} })[0]).toMatch(/inconnu/);
  });

  it("chaque déclencheur a sa définition et des audiences", () => {
    for (const t of SUPPORTED_TRIGGERS) {
      expect(triggerDef(t.trigger)).toBe(t);
      expect(t.audiences.length).toBeGreaterThan(0);
    }
  });
});
