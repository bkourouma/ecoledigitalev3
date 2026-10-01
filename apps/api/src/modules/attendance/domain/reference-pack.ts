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
  readonly callPolicies: ReadonlyArray<{ educationLevel: string; callScope: CallScope; editWindowMinutes?: number; dailyMinutes?: number; lateRequiresMinutes?: boolean }>;
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
  return ok({
    section: "attendance",
    schemaVersion: 1,
    educationSystem: t.educationSystem,
    statusDefinitions: t.statusDefinitions ?? [],
    justificationReasons: t.justificationReasons ?? [],
    leaveTypes: t.leaveTypes ?? [],
    callPolicies: t.callPolicies ?? [],
    settings: { ...(t.settings ?? {}), alertRules: rules.value },
  });
}
