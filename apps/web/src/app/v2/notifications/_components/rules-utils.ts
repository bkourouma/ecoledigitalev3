import {
  NOTIF_AUDIENCE_KINDS,
  NOTIF_LIMITS,
  type NotifAudience,
  type NotifChannel,
  type NotifRuleConditions,
  type NotifRuleKind,
  type NotifRuleView,
  type NotifStrategy,
  type NotifTemplateCode,
} from "@ecoledigitale/contracts/v2/notifications";
import { parseStages } from "./notifications-utils";

export type AudienceKind = (typeof NOTIF_AUDIENCE_KINDS)[number];
export const AUDIENCE_KINDS = NOTIF_AUDIENCE_KINDS;

export type ConditionField = "stages" | "minDaysOverdue" | "minDrop" | "maxHours" | "minValue" | "priorities" | "daysBefore";
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const CLASSROOM_INCLUDES = ["GUARDIANS", "STUDENTS", "TEACHERS"] as const;
export type ClassroomInclude = (typeof CLASSROOM_INCLUDES)[number];

/** Seuils pertinents pour une règle : ils dépendent du déclencheur (le serveur valide le reste). */
export function conditionFieldsOf(rule: Pick<NotifRuleView, "kind" | "trigger">): ConditionField[] {
  if (rule.kind === "DUNNING") return ["stages"];
  if (rule.kind === "ALERT") {
    if (rule.trigger === "OVERDUE_DAYS") return ["minDaysOverdue"];
    if (rule.trigger === "GRADE_DROP") return ["minDrop"];
    if (rule.trigger === "TEACHING_LOAD") return ["maxHours"];
    return [];
  }
  if (rule.trigger === "attendance.alert.triggered") return ["minValue"];
  if (rule.trigger === "messaging.announcement.published") return ["priorities"];
  if (rule.trigger === "people.staff_qualification.expiring") return ["daysBefore"];
  return [];
}

export interface RuleDraft {
  enabled: boolean;
  templateCode: NotifTemplateCode;
  channels: NotifChannel[];
  strategy: NotifStrategy;
  urgent: boolean;
  audienceKind: AudienceKind;
  financialFirst: boolean;
  fallbackToStudent: boolean;
  roleKeys: string;
  include: ClassroomInclude[];
  /** Valeurs saisies (texte) des seuils. */
  values: Partial<Record<ConditionField, string>>;
  priorities: Array<(typeof PRIORITIES)[number]>;
}

const show = (n: number | undefined) => (n === undefined ? "" : String(n));

export function draftOf(rule: NotifRuleView): RuleDraft {
  const a = rule.audience;
  const c = rule.conditions;
  return {
    enabled: rule.enabled,
    templateCode: rule.templateCode,
    channels: [...rule.channels],
    strategy: rule.strategy,
    urgent: rule.urgent,
    audienceKind: a.kind,
    financialFirst: a.kind === "STUDENT_GUARDIANS" ? a.financialFirst : false,
    fallbackToStudent: a.kind === "STUDENT_GUARDIANS" ? a.fallbackToStudent : false,
    roleKeys: a.kind === "ROLES" ? a.roleKeys.join(", ") : "",
    include: a.kind === "CLASSROOM" ? [...a.include] : ["GUARDIANS"],
    values: {
      stages: c.stages ? c.stages.join(", ") : "",
      minDaysOverdue: show(c.minDaysOverdue),
      minDrop: show(c.minDrop),
      maxHours: show(c.maxHours),
      minValue: show(c.minValue),
      daysBefore: show(c.daysBefore),
    },
    priorities: [...(c.priorities ?? [])],
  };
}

export type RuleIssue = "channels" | "roles" | "include" | "stages" | "stagesOrder" | "number";

const ROLE_KEY = /^[a-z][a-z0-9_]{1,59}$/;

/** Corps d'enregistrement (ou la première erreur de saisie). Aucune règle métier : mise en forme et bornes de saisie. */
export function buildRuleBody(
  rule: Pick<NotifRuleView, "kind" | "trigger" | "conditions" | "custom">,
  d: RuleDraft,
): { ok: true; audience: NotifAudience; conditions: NotifRuleConditions } | { ok: false; issue: RuleIssue; field?: ConditionField } {
  if (d.channels.length === 0) return { ok: false, issue: "channels" };
  let audience: NotifAudience;
  switch (d.audienceKind) {
    case "STUDENT_GUARDIANS":
      audience = { kind: "STUDENT_GUARDIANS", financialFirst: d.financialFirst, fallbackToStudent: d.fallbackToStudent };
      break;
    case "ROLES": {
      const roleKeys = d.roleKeys.split(/[,\s;]+/).filter(Boolean);
      if (roleKeys.length === 0 || roleKeys.length > NOTIF_LIMITS.roleKeysMax || !roleKeys.every((k) => ROLE_KEY.test(k))) return { ok: false, issue: "roles" };
      audience = { kind: "ROLES", roleKeys };
      break;
    }
    case "CLASSROOM":
      if (d.include.length === 0) return { ok: false, issue: "include" };
      audience = { kind: "CLASSROOM", include: d.include };
      break;
    default:
      audience = { kind: d.audienceKind } as NotifAudience;
  }

  const conditions: NotifRuleConditions = { ...rule.conditions };
  for (const field of conditionFieldsOf(rule)) {
    if (field === "priorities") {
      if (d.priorities.length > 0) conditions.priorities = d.priorities;
      else delete conditions.priorities;
      continue;
    }
    const text = (d.values[field] ?? "").trim();
    if (field === "stages") {
      const stages = text === "" ? null : parseStages(text);
      if (!stages || stages.length > NOTIF_LIMITS.stagesMax) return { ok: false, issue: "stages", field };
      if (!stages.every((s, i) => i === 0 || s > stages[i - 1]!)) return { ok: false, issue: "stagesOrder", field };
      conditions.stages = stages;
      continue;
    }
    const raw = text.replace(",", ".");
    if (raw === "") {
      delete conditions[field];
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, issue: "number", field };
    if (field === "minDrop" || field === "maxHours") conditions[field] = n;
    else if (!Number.isInteger(n)) return { ok: false, issue: "number", field };
    else conditions[field] = n;
  }
  return { ok: true, audience, conditions };
}

export const RULE_KINDS: readonly NotifRuleKind[] = ["EVENT", "ALERT", "DUNNING"];
