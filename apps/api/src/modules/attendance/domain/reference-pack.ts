/**
 * Modèle de pack de la section `attendance` (donnée, pas règle réglementaire) : statuts, motifs de justification,
 * types de congé, politiques d'appel par cycle, paramètres de pièces et règles d'alerte.
 *
 * Ces valeurs sont des POLITIQUES D'ÉTABLISSEMENT MODIFIABLES (spec 010 §7) :
 *  - les statuts système (PRESENT, ABSENT, LATE, EXCUSED, EARLY_LEAVE ; personnel : PRESENT, ABSENT, LATE, ON_LEAVE)
 *    sont verrouillés (is_system) ; un tenant peut en AJOUTER ;
 *  - AUCUN seuil d'absentéisme, AUCUNE équivalence « N retards = 1 absence », AUCUNE durée légale de congé : tant que
 *    le propriétaire n'a pas fourni les textes (open-questions O-09), `alertRules` reste vide et chaque établissement
 *    déclare les siens (`upsertAttendanceSettings`).
 *  - la durée de fenêtre de correction d'un appel est une politique d'établissement par cycle.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, validation } from "./errors";
import { parseAlertRules, type AlertRule } from "./alerts";
import type { AttachmentType, CallScope, SubjectKind } from "./types";

export interface PackStatus {
  readonly subject: SubjectKind;
  readonly code: string;
  readonly label: string;
  readonly present?: boolean;
  readonly absence?: boolean;
  readonly late?: boolean;
  readonly justified?: boolean;
  readonly requiresJustification?: boolean;
  readonly system?: boolean;
}

export interface AttendancePackTemplate {
  readonly section: "attendance";
  readonly schemaVersion: 1;
  readonly educationSystem: string;
  readonly statusDefinitions: readonly PackStatus[];
  readonly justificationReasons: ReadonlyArray<{ code: string; label: string; requiresAttachment?: boolean }>;
  readonly leaveTypes: ReadonlyArray<{ code: string; label: string; paid?: boolean; requiresApproval?: boolean; requiresAttachment?: boolean }>;
  /**
   * Politiques d'appel NORMALISÉES (une ligne par niveau d'enseignement). Un fichier de gabarit peut les déclarer sous la forme
   * `{ code, label, scope, educationLevels: [...], dailyMinutes }` (voir `PackCallPolicyDeclaration`) : `validatePackTemplate`
   * les développe. `dailyMinutes = null` : aucune conversion en minutes (les récapitulatifs ne comptent que des jours).
   */
  readonly callPolicies: ReadonlyArray<{
    code?: string;
    label?: string;
    educationLevel: string;
    callScope: CallScope;
    editWindowMinutes?: number | null;
    dailyMinutes?: number | null;
    lateRequiresMinutes?: boolean;
  }>;
  readonly settings: {
    readonly attachmentMaxBytes?: number;
    readonly allowedAttachmentTypes?: readonly AttachmentType[];
    readonly allowFutureJustifications?: boolean;
    readonly alertRules?: readonly AlertRule[];
  };
}

/** Modèle par défaut (système éducatif « CI »). */
export const DEFAULT_ATTENDANCE_PACK: AttendancePackTemplate = Object.freeze({
  section: "attendance",
  schemaVersion: 1,
  educationSystem: "CI",
  statusDefinitions: [
    { subject: "STUDENT", code: "PRESENT", label: "Présent", present: true, system: true },
    { subject: "STUDENT", code: "ABSENT", label: "Absent", absence: true, system: true },
    { subject: "STUDENT", code: "LATE", label: "En retard", present: true, late: true, system: true },
    { subject: "STUDENT", code: "EXCUSED", label: "Absence justifiée", absence: true, justified: true, system: true },
    { subject: "STUDENT", code: "EARLY_LEAVE", label: "Départ anticipé", present: true, system: true },
    { subject: "STAFF", code: "PRESENT", label: "Présent", present: true, system: true },
    { subject: "STAFF", code: "ABSENT", label: "Absent", absence: true, system: true },
    { subject: "STAFF", code: "LATE", label: "En retard", present: true, late: true, system: true },
    { subject: "STAFF", code: "ON_LEAVE", label: "En congé", system: true },
  ],
  justificationReasons: [
    { code: "ILLNESS", label: "Maladie", requiresAttachment: false },
    { code: "FAMILY_EVENT", label: "Événement familial" },
    { code: "TRANSPORT", label: "Difficulté de transport" },
    { code: "OFFICIAL_ACTIVITY", label: "Activité officielle" },
    { code: "OTHER", label: "Autre" },
  ],
  leaveTypes: [
    { code: "ANNUAL", label: "Congé annuel", paid: true },
    { code: "SICK", label: "Congé maladie", paid: true, requiresAttachment: true },
    { code: "MATERNITY", label: "Congé de maternité", paid: true },
    { code: "UNPAID", label: "Congé sans solde", paid: false },
    { code: "AUTHORIZED_ABSENCE", label: "Absence autorisée", paid: false },
  ],
  callPolicies: [
    { educationLevel: "PRESCHOOL", callScope: "DAILY" },
    { educationLevel: "PRIMARY", callScope: "DAILY" },
    { educationLevel: "*", callScope: "SESSION", editWindowMinutes: 120 },
  ],
  settings: { attachmentMaxBytes: 5_242_880, allowedAttachmentTypes: ["application/pdf", "image/jpeg", "image/png"], allowFutureJustifications: false, alertRules: [] },
} satisfies AttendancePackTemplate);

const CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;
const CALL_SCOPES: readonly CallScope[] = ["DAILY", "SESSION", "BOTH"];

/** Forme DÉCLARATIVE d'une politique d'appel dans un fichier de gabarit (`templates/CI/primary.json`). */
export interface PackCallPolicyDeclaration {
  readonly code: string;
  readonly label: string;
  readonly scope: CallScope;
  readonly educationLevels: readonly string[];
  readonly dailyMinutes?: number | null;
  readonly editWindowMinutes?: number | null;
  readonly lateRequiresMinutes?: boolean;
}

type NormalizedCallPolicy = AttendancePackTemplate["callPolicies"][number];

/**
 * Normalise les politiques d'appel d'un gabarit : accepte la forme déclarative (`scope` + `educationLevels`) ET la forme
 * normalisée (`callScope` + `educationLevel`). Un niveau n'apparaît qu'une fois. Aucune valeur réglementaire : une durée
 * (`dailyMinutes`) absente ou `null` signifie « on ne compte que des jours ».
 */
export function normalizeCallPolicies(raw: unknown): Result<NormalizedCallPolicy[], AppError> {
  const bad = (m: string): Result<never, AppError> => err(validation(AttendanceCode.INVALID_INPUT, `Modèle de pack attendance invalide : politique d'appel ${m}`, "callPolicies"));
  if (raw === undefined || raw === null) return ok([]);
  if (!Array.isArray(raw)) return bad("(liste attendue).");
  const out: NormalizedCallPolicy[] = [];
  const seen = new Set<string>();
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") return bad("(objet attendu).");
    const who = String(item.code ?? item.educationLevel ?? "?");
    const scope = (item.scope ?? item.callScope) as CallScope;
    if (!CALL_SCOPES.includes(scope)) return bad(`« ${who} » : portée ${String(scope)} inconnue.`);
    const levels: unknown[] = Array.isArray(item.educationLevels) ? item.educationLevels : item.educationLevel !== undefined ? [item.educationLevel] : [];
    if (levels.length === 0 || levels.some((l) => typeof l !== "string" || l.trim() === "")) return bad(`« ${who} » : niveaux d'enseignement manquants.`);
    const daily = item.dailyMinutes;
    if (daily !== undefined && daily !== null && (typeof daily !== "number" || !Number.isInteger(daily) || daily <= 0)) return bad(`« ${who} » : dailyMinutes doit être null ou un entier positif.`);
    const edit = item.editWindowMinutes;
    if (edit !== undefined && edit !== null && (typeof edit !== "number" || !Number.isInteger(edit) || edit < 0)) return bad(`« ${who} » : editWindowMinutes invalide.`);
    for (const level of levels as string[]) {
      if (seen.has(level)) return bad(`: niveau « ${level} » déclaré deux fois.`);
      seen.add(level);
      out.push({
        ...(typeof item.code === "string" ? { code: item.code } : {}),
        ...(typeof item.label === "string" ? { label: item.label } : {}),
        educationLevel: level,
        callScope: scope,
        ...(edit !== undefined ? { editWindowMinutes: edit as number | null } : {}),
        ...(daily !== undefined ? { dailyMinutes: daily as number | null } : {}),
        ...(item.lateRequiresMinutes === true ? { lateRequiresMinutes: true } : {}),
      });
    }
  }
  return ok(out);
}

/** Valide un modèle de pack (JSON d'un fichier de gabarit) avant instanciation. */
export function validatePackTemplate(raw: unknown): Result<AttendancePackTemplate, AppError> {
  const t = raw as Partial<AttendancePackTemplate> | null;
  const bad = (m: string): Result<never, AppError> => err(validation(AttendanceCode.INVALID_INPUT, `Modèle de pack attendance invalide : ${m}`, "pack"));
  if (!t || typeof t !== "object") return bad("objet attendu.");
  if (t.section !== "attendance" || t.schemaVersion !== 1) return bad("section « attendance », schemaVersion 1 attendus.");
  if (typeof t.educationSystem !== "string" || t.educationSystem.length === 0) return bad("educationSystem manquant.");
  for (const s of t.statusDefinitions ?? []) {
    if (!CODE_RE.test(s.code) || (s.subject !== "STUDENT" && s.subject !== "STAFF") || s.label.trim() === "") return bad(`statut ${String(s.code)}.`);
    if (s.present && s.absence) return bad(`statut ${s.code} : présence et absence incompatibles.`);
    if (s.justified && !s.absence && !s.late) return bad(`statut ${s.code} : « justifié » exige absence ou retard.`);
  }
  for (const r of t.justificationReasons ?? []) if (!CODE_RE.test(r.code) || r.label.trim() === "") return bad(`motif ${String(r.code)}.`);
  for (const l of t.leaveTypes ?? []) if (!CODE_RE.test(l.code) || l.label.trim() === "") return bad(`type de congé ${String(l.code)}.`);
  const rules = parseAlertRules(t.settings?.alertRules ?? []);
  if (!rules.ok) return rules;
  const policies = normalizeCallPolicies(t.callPolicies);
  if (!policies.ok) return policies;
  return ok({
    section: "attendance",
    schemaVersion: 1,
    educationSystem: t.educationSystem,
    statusDefinitions: t.statusDefinitions ?? [],
    justificationReasons: t.justificationReasons ?? [],
    leaveTypes: t.leaveTypes ?? [],
    callPolicies: policies.value,
    settings: { ...(t.settings ?? {}), alertRules: rules.value },
  });
}
