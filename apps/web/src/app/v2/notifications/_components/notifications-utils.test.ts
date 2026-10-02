import { describe, expect, it } from "vitest";
import { ruleView } from "../_test/fixtures";
import { endOfDay, parseStages, startOfDay } from "./notifications-utils";
import { pushSupported, subscribeThisDevice, urlBase64ToUint8Array } from "./push-client";
import { buildRuleBody, conditionFieldsOf, draftOf } from "./rules-utils";
import type { NotifRuleView } from "@ecoledigitale/contracts/v2/notifications";

const rule = (over: Record<string, unknown> = {}) => ruleView(over) as unknown as NotifRuleView;

describe("notifications-utils", () => {
  it("période du journal : début de journée et borne exclusive en UTC", () => {
    expect(startOfDay("2026-09-30")).toBe("2026-09-30T00:00:00.000Z");
    expect(endOfDay("2026-09-30")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("paliers saisis : entiers positifs séparés par virgules, espaces ou points-virgules", () => {
    expect(parseStages("3, 10; 30")).toEqual([3, 10, 30]);
    expect(parseStages("3 x")).toBeNull();
    expect(parseStages("0, 5")).toBeNull();
    expect(parseStages("2.5")).toBeNull();
    expect(parseStages("")).toBeNull();
  });
});

describe("rules-utils", () => {
  it("les seuils proposés dépendent du déclencheur", () => {
    expect(conditionFieldsOf(rule())).toEqual(["stages"]);
    expect(conditionFieldsOf(rule({ kind: "ALERT", trigger: "OVERDUE_DAYS" }))).toEqual(["minDaysOverdue"]);
    expect(conditionFieldsOf(rule({ kind: "ALERT", trigger: "GRADE_DROP" }))).toEqual(["minDrop"]);
    expect(conditionFieldsOf(rule({ kind: "ALERT", trigger: "TEACHING_LOAD" }))).toEqual(["maxHours"]);
    expect(conditionFieldsOf(rule({ kind: "EVENT", trigger: "attendance.alert.triggered" }))).toEqual(["minValue"]);
    expect(conditionFieldsOf(rule({ kind: "EVENT", trigger: "messaging.announcement.published" }))).toEqual(["priorities"]);
    expect(conditionFieldsOf(rule({ kind: "EVENT", trigger: "people.staff_qualification.expiring" }))).toEqual(["daysBefore"]);
    expect(conditionFieldsOf(rule({ kind: "EVENT", trigger: "finance.invoice.issued" }))).toEqual([]);
  });

  it("construit le corps : conserve les autres seuils, retire un seuil vidé, accepte la virgule décimale", () => {
    const r = rule({ kind: "ALERT", trigger: "GRADE_DROP", conditions: { minDrop: 2, metrics: ["X"] } });
    const d = draftOf(r);
    d.values.minDrop = "1,5";
    const ok = buildRuleBody(r, d);
    expect(ok).toEqual({ ok: true, audience: { kind: "STUDENT_GUARDIANS", financialFirst: true, fallbackToStudent: false }, conditions: { minDrop: 1.5, metrics: ["X"] } });
    d.values.minDrop = "";
    expect(buildRuleBody(r, d)).toMatchObject({ ok: true, conditions: { metrics: ["X"] } });
    d.values.minDrop = "abc";
    expect(buildRuleBody(r, d)).toEqual({ ok: false, issue: "number", field: "minDrop" });
  });

  it("refuse : aucun canal, rôles invalides, paliers non croissants ou trop nombreux, entier attendu", () => {
    const r = rule();
    const d = draftOf(r);
    expect(buildRuleBody(r, { ...d, channels: [] })).toEqual({ ok: false, issue: "channels" });
    expect(buildRuleBody(r, { ...d, audienceKind: "ROLES", roleKeys: "Teacher!" })).toEqual({ ok: false, issue: "roles" });
    expect(buildRuleBody(r, { ...d, audienceKind: "ROLES", roleKeys: "teacher, accountant" })).toMatchObject({ ok: true, audience: { kind: "ROLES", roleKeys: ["teacher", "accountant"] } });
    expect(buildRuleBody(r, { ...d, audienceKind: "CLASSROOM", include: [] })).toEqual({ ok: false, issue: "include" });
    expect(buildRuleBody(r, { ...d, values: { stages: "5, 5" } })).toEqual({ ok: false, issue: "stagesOrder", field: "stages" });
    expect(buildRuleBody(r, { ...d, values: { stages: "1,2,3,4,5,6,7" } })).toEqual({ ok: false, issue: "stages", field: "stages" });
    const alert = rule({ kind: "ALERT", trigger: "OVERDUE_DAYS", conditions: {} });
    const ad = draftOf(alert);
    ad.values.minDaysOverdue = "2.5";
    expect(buildRuleBody(alert, ad)).toEqual({ ok: false, issue: "number", field: "minDaysOverdue" });
  });
});

describe("push-client", () => {
  it("clé VAPID base64url -> octets", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });

  it("sans Web Push (jsdom ou navigateur ancien) : non pris en charge, aucune demande d'autorisation", async () => {
    expect(pushSupported()).toBe(false);
    await expect(subscribeThisDevice("AQID", "Téléphone")).rejects.toMatchObject({ reason: "unsupported" });
  });
});
