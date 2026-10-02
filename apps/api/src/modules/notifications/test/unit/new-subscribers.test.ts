/**
 * Abonnés ajoutés : alertes internes (rapprochement finance, élèves affectés par l'État), vie scolaire (texte neutre),
 * admissions (candidat). Lecteurs d'événements, règles livrées, gabarits : aucune donnée sensible dans les messages.
 */
import { describe, expect, it } from "vitest";
import { catalogEntry } from "../../domain/catalog";
import { DEFAULT_RULES } from "../../domain/default-rules";
import { findShippedTemplate } from "../../domain/default-templates";
import { conditionsMatch, readEvent } from "../../domain/event-readers";
import { CONSUMED_EVENT_TYPES, ConsumedEvents } from "../../domain/events";
import { renderSource, validateTemplateSource } from "../../domain/templating";
import { EVENT_TRIGGERS, validateRuleDef } from "../../domain/triggers";

const U = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${n.toString(16).padStart(12, "0")}`;
const [P, R, S, A, O, C, M, K] = [U(1), U(2), U(3), U(4), U(5), U(6), U(7), U(8)];

const facts = (type: string, payload: unknown) => {
  const r = readEvent(type, payload);
  if (r.kind !== "facts") throw new Error(`attendu : faits, reçu ${JSON.stringify(r)}`);
  return r.facts;
};

describe("événements consommés ajoutés", () => {
  it("sont déclarés, ont un déclencheur et sont consommés", () => {
    for (const t of [
      "finance.payment.reconciliation_needed",
      "finance.refund.reconciliation_needed",
      "stateassign.reconciliation.discrepancy",
      "stateassign.receivable.overdue",
      "stateassign.control.due",
      "stateassign.control.anomaly_detected",
      "schoollife.measure.notified",
      "schoollife.convocation.sent",
      "schoollife.convocation.cancelled",
      "admissions.application.submitted",
      "admissions.offer.issued",
    ]) {
      expect(CONSUMED_EVENT_TYPES, t).toContain(t);
      expect(EVENT_TRIGGERS, t).toContain(t);
    }
  });

  it("rapprochement finance : montant, fournisseur, motif neutre ; jamais de nom ni de message du fournisseur ; une alerte par élément et motif", () => {
    const payload = { v: 1, subject: "PAYMENT", paymentId: P, learnerId: S, amount: { amount: 25000, currency: "XOF" }, provider: "orange_money", reason: "attempts_exhausted", attempts: 6, lastErrorCode: "E42" };
    const f = facts(ConsumedEvents.PAYMENT_RECONCILIATION_NEEDED, payload);
    expect(f.values).toEqual({ subject: "paiement", amount: { amount: 25000, currency: "XOF" }, provider: "orange_money", reason: "vérifications automatiques épuisées" });
    expect(f.refs).toEqual({}); // aucun élève : l'alerte ne nomme personne
    expect(f.dedupeId).toBe(`${P}:attempts_exhausted`);
    expect(f.linkPath).toBe("/v2/finance/payments/pending");
    expect(JSON.stringify(f)).not.toContain(S);
    expect(JSON.stringify(f)).not.toContain("E42");

    const refund = facts(ConsumedEvents.REFUND_RECONCILIATION_NEEDED, { ...payload, subject: "REFUND", refundId: R, reason: "code_inconnu", provider: null });
    expect(refund.values).toEqual({ subject: "remboursement", amount: { amount: 25000, currency: "XOF" } });
    expect(refund.dedupeId).toBe(`${R}:code_inconnu`);

    expect(readEvent(ConsumedEvents.PAYMENT_RECONCILIATION_NEEDED, { v: 1, paymentId: P }).kind).toBe("unreadable");
    expect(readEvent(ConsumedEvents.PAYMENT_RECONCILIATION_NEEDED, null).kind).toBe("unreadable");
  });

  it("élèves affectés par l'État : libellés neutres, dates, jours de retard, reste à recevoir ; un écart soldé est ignoré", () => {
    const d = facts(ConsumedEvents.STATE_RECONCILIATION_DISCREPANCY, { v: 1, assignmentId: A, enrollmentId: U(9), studentId: S, institutionId: U(10), academicYearId: U(11), version: 3, status: "DISCREPANCY", stateDelta: { amount: 1000, currency: "XOF" }, parentDelta: { amount: 0, currency: "XOF" } });
    expect(d.values).toEqual({ alertLabel: "Écart de rapprochement avec la part de l'État" });
    expect(d.dedupeId).toBe(`${A}:3`);
    expect(JSON.stringify(d)).not.toContain(S);
    expect(readEvent(ConsumedEvents.STATE_RECONCILIATION_DISCREPANCY, { v: 1, assignmentId: A, status: "BALANCED" })).toEqual({ kind: "skip", reason: "balanced" });

    const o = facts(ConsumedEvents.STATE_RECEIVABLE_OVERDUE, { v: 1, receivableId: A, assignmentId: A, studentId: S, dueOn: "2026-09-30", expected: { amount: 300000, currency: "XOF" }, received: { amount: 100000, currency: "XOF" }, status: "OVERDUE", daysOverdue: 12 });
    expect(o.values).toEqual({ alertLabel: "Créance de l'État en retard", dueDate: "2026-09-30", daysOverdue: 12, amount: { amount: 200000, currency: "XOF" } });
    expect(o.dedupeId).toBe(A);
    expect(o.filters.daysOverdue).toBe(12);
    // devises différentes : pas de reste inventé
    expect(facts(ConsumedEvents.STATE_RECEIVABLE_OVERDUE, { v: 1, receivableId: A, dueOn: "2026-09-30", expected: { amount: 3, currency: "XOF" }, received: { amount: 1, currency: "EUR" }, daysOverdue: 0 }).values).toEqual({ alertLabel: "Créance de l'État en retard", dueDate: "2026-09-30" });

    const due = facts(ConsumedEvents.STATE_CONTROL_DUE, { v: 1, controlId: C, assignmentId: A, studentId: S, kind: "ATTENDANCE", status: "PENDING", dueOn: "2026-10-05" });
    expect(due.values.dueDate).toBe("2026-10-05");
    expect(due.dedupeId).toBe(`${C}:2026-10-05`);
    expect(facts(ConsumedEvents.STATE_CONTROL_ANOMALY, { v: 1, controlId: C, dueOn: "2026-10-05" }).values.alertLabel).toMatch(/Anomalie/);
    for (const t of [ConsumedEvents.STATE_RECEIVABLE_OVERDUE, ConsumedEvents.STATE_CONTROL_DUE, ConsumedEvents.STATE_CONTROL_ANOMALY, ConsumedEvents.STATE_RECONCILIATION_DISCREPANCY]) {
      expect(readEvent(t, { v: 1 }).kind, t).toBe("unreadable");
    }
  });

  it("vie scolaire : seuls l'élève et l'identifiant comptent (ni nature, ni gravité, ni motif) ; confidentiel ou non visible = ignoré", () => {
    const measure = { v: 1, measureId: M, enrollmentId: U(9), studentId: S, kind: "EXCLUSION", typeId: U(12), severityCode: "GRAVE", startsOn: "2026-10-12", endsOn: "2026-10-14", confidentiality: "NORMAL", visibleToGuardians: true };
    const f = facts(ConsumedEvents.MEASURE_NOTIFIED, measure);
    expect(f.refs).toEqual({ studentId: S });
    expect(f.values).toEqual({});
    expect(JSON.stringify(f)).not.toMatch(/EXCLUSION|GRAVE|2026-10-1/);
    expect(readEvent(ConsumedEvents.MEASURE_NOTIFIED, { ...measure, visibleToGuardians: false })).toEqual({ kind: "skip", reason: "not_shareable" });
    expect(readEvent(ConsumedEvents.MEASURE_NOTIFIED, { ...measure, confidentiality: "CONFIDENTIAL" })).toEqual({ kind: "skip", reason: "not_shareable" });

    const conv = { v: 1, convocationId: C, enrollmentId: U(9), studentId: S, reasonKind: "DISCIPLINE", scheduledAt: "2026-10-09T09:30:00Z" };
    const sent = facts(ConsumedEvents.CONVOCATION_SENT, conv);
    expect(sent.startsAt).toBe("2026-10-09T09:30:00Z");
    expect(sent.values).toEqual({});
    expect(JSON.stringify(sent)).not.toContain("DISCIPLINE");
    const cancelled = facts(ConsumedEvents.CONVOCATION_CANCELLED, conv);
    expect(cancelled.values).toEqual({ statusLabel: "annulée" });
    expect(cancelled.dedupeId).toBe(`${C}:cancelled`);
    expect(readEvent(ConsumedEvents.CONVOCATION_SENT, { ...conv, scheduledAt: "pas une date" }).kind).toBe("unreadable");
  });

  it("admissions : identifiants seulement ; un import ou une conversion de prospect n'envoie aucun accusé", () => {
    const f = facts(ConsumedEvents.APPLICATION_SUBMITTED, { v: 1, applicationId: A, campaignId: U(13), institutionId: U(10), gradeLevelCode: "6EME", via: "PUBLIC_FORM" });
    expect(f.refs).toEqual({ applicationId: A });
    expect(f.dedupeId).toBe(A);
    expect(facts(ConsumedEvents.APPLICATION_SUBMITTED, { v: 1, applicationId: A, via: "STAFF" }).refs.applicationId).toBe(A);
    for (const via of ["IMPORT", "PROSPECT"]) expect(readEvent(ConsumedEvents.APPLICATION_SUBMITTED, { v: 1, applicationId: A, via })).toEqual({ kind: "skip", reason: "via_not_applicant_facing" });
    const offer = facts(ConsumedEvents.OFFER_ISSUED, { v: 1, applicationId: A, offerId: O, classroomId: null });
    expect(offer.refs).toEqual({ applicationId: A });
    expect(offer.dedupeId).toBe(O);
    expect(readEvent(ConsumedEvents.OFFER_ISSUED, { v: 1, applicationId: A }).kind).toBe("unreadable");
  });

  it("le seuil de jours de retard d'une règle s'applique à la créance de l'État", () => {
    expect(conditionsMatch({ conditions: { minDaysOverdue: 10 } }, { daysOverdue: 12 })).toBe(true);
    expect(conditionsMatch({ conditions: { minDaysOverdue: 10 } }, { daysOverdue: 3 })).toBe(false);
  });
});

describe("règles livrées ajoutées", () => {
  const byKey = (key: string) => DEFAULT_RULES.find((r) => r.key === key)!;

  it("sont valides (déclencheur, audience, variables fournies)", () => {
    for (const rule of DEFAULT_RULES) expect(validateRuleDef(rule), rule.key).toEqual([]);
  });

  it("les alertes internes sont actives et visent l'économat (et la direction) par rôle, jamais les familles", () => {
    for (const key of ["finance.payment_reconciliation_needed", "finance.refund_reconciliation_needed", "stateassign.control_anomaly", "stateassign.control_due"]) {
      const r = byKey(key);
      expect(r.enabled, key).toBe(true);
      expect(r.audience).toEqual({ kind: "ROLES", roleKeys: ["econome", "directeur"] });
      expect(catalogEntry(r.templateCode)?.staffFacing, key).toBe(true);
    }
    for (const key of ["stateassign.reconciliation_discrepancy", "stateassign.receivable_overdue"]) {
      expect(byKey(key).enabled).toBe(true);
      expect(byKey(key).audience).toEqual({ kind: "ROLES", roleKeys: ["econome"] });
    }
  });

  it("vie scolaire et admissions : désactivées par défaut (risque de doublon avec les canaux propres des modules)", () => {
    for (const key of ["schoollife.measure_notified.guardians", "schoollife.convocation_sent.guardians", "schoollife.convocation_cancelled.guardians", "admissions.application_received.applicant", "admissions.offer_issued.applicant"]) {
      expect(byKey(key).enabled, key).toBe(false);
    }
    expect(byKey("admissions.application_received.applicant").strategy).toBe("FIRST_REACHABLE");
    // aucun SMS en tête : le canal le moins coûteux d'abord
    expect(byKey("admissions.application_received.applicant").channels.at(-1)).toBe("SMS");
  });

  it("une règle d'admissions n'accepte pas l'audience des familles d'élèves", () => {
    const issues = validateRuleDef({ kind: "EVENT", trigger: ConsumedEvents.OFFER_ISSUED, templateCode: "admissions_offer_issued", audience: { kind: "STUDENT_GUARDIANS", financialFirst: false, fallbackToStudent: false }, channels: ["EMAIL"], conditions: {} });
    expect(issues.join(" ")).toMatch(/audience/i);
  });
});

describe("gabarits livrés ajoutés : texte neutre, aucune donnée sensible", () => {
  const render = (code: string, channel: "SMS" | "EMAIL", values: Record<string, unknown>): string => {
    const entry = catalogEntry(code)!;
    const t = findShippedTemplate(code, channel)!;
    const { issues } = validateTemplateSource({ entry, channel, subject: t.subject, body: t.body });
    expect(issues).toEqual([]);
    const out = renderSource(t.body, entry, { schoolName: "Les Palmiers", appUrl: "https://ecole.example.org", ...values }, { appUrl: "https://ecole.example.org" });
    expect(out.errors).toEqual([]);
    return out.text;
  };

  it("vie scolaire : convocation et décision ne disent ni la nature ni le motif", () => {
    const conv = render("schoollife_convocation", "SMS", { studentName: "Awa Koné", date: "2026-10-09", time: "09:30", place: "Bureau de la vie scolaire" });
    expect(conv).toContain("Awa Koné");
    expect(conv).toContain("09:30");
    expect(conv).not.toMatch(/disciplin|sanction|exclusion|motif|incident/i);
    expect(render("schoollife_convocation", "SMS", { studentName: "Awa Koné", date: "2026-10-09", time: "09:30", statusLabel: "annulée" })).toMatch(/Convocation annulée/);
    const measure = render("schoollife_measure_notified", "EMAIL", { studentName: "Awa Koné" });
    expect(measure).toContain("décision de vie scolaire");
    expect(measure).not.toMatch(/exclusion|sanction|avertissement|motif|renvoi/i);
  });

  it("alertes internes : montant et libellés, aucun nom d'élève ni message du fournisseur", () => {
    const rec = render("reconciliation_needed", "SMS", { subject: "paiement", amount: { amount: 25000, currency: "XOF" }, provider: "orange_money", reason: "vérifications automatiques épuisées" });
    expect(rec).toMatch(/25\s?000/);
    expect(rec).toContain("Paiements à rapprocher");
    const state = render("stateassign_alert", "SMS", { alertLabel: "Créance de l'État en retard", dueDate: "2026-09-30", daysOverdue: 12, amount: { amount: 200000, currency: "XOF" } });
    expect(state).toContain("Créance de l'État en retard");
    expect(state).toContain("12 jours de retard");
    const bare = render("stateassign_alert", "EMAIL", { alertLabel: "Contrôle d'un élève affecté par l'État à effectuer" });
    expect(bare).not.toMatch(/\{\{/);
  });

  it("admissions : accusé et offre sans nom, sans motif, sans lien secret", () => {
    for (const code of ["admissions_application_received", "admissions_offer_issued"]) {
      for (const channel of ["SMS", "EMAIL"] as const) {
        const text = render(code, channel, {});
        expect(text, `${code}/${channel}`).not.toMatch(/token|http[s]?:\/\/[^\s]*\?/i);
        expect(text.length).toBeGreaterThan(20);
      }
    }
  });
});
