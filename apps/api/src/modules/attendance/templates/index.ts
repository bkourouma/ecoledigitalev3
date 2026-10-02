/**
 * Modèles de pack de la section `attendance` : un fichier JSON par (système éducatif, pack), validé au chargement.
 * Ajouter un pays ou un pack = ajouter un fichier JSON et l'inscrire ci-dessous ; aucune logique ne change.
 *
 * Un fichier ne déclare que ce qui DIFFÈRE du modèle de base (`DEFAULT_ATTENDANCE_PACK` : statuts, motifs, types de congé,
 * paramètres de pièces) : les sections absentes sont héritées de la base. Ici : la politique d'appel `PRIMARY_DAILY`
 * (appel journalier pour `PRESCHOOL` et `PRIMARY`, `dailyMinutes = null` : aucune conversion en minutes, les récapitulatifs
 * ne comptent que des jours). Rien n'est réglementaire (spec 005 §14.2, `pack-template.md` §3).
 *
 * Les packs `SECONDARY` et `HIGHER` n'ont pas de fichier : ils utilisent la base (appel par séance `*`, 120 min de fenêtre).
 */
import { validatePackTemplate, DEFAULT_ATTENDANCE_PACK, type AttendancePackTemplate } from "../domain/reference-pack";
import ciPrimary from "./CI/primary.json";

export type AttendanceTemplates = ReadonlyMap<string, AttendancePackTemplate>;

export const attendanceTemplateKey = (educationSystem: string, pack: string): string => `${educationSystem}:${pack}`;

/** Valide une liste de fichiers de gabarit (un seul par système éducatif et pack) et les complète avec la base. */
export function buildAttendanceTemplates(raw: readonly unknown[]): AttendanceTemplates {
  const map = new Map<string, AttendancePackTemplate>();
  for (const entry of raw) {
    const r = entry as { pack?: unknown; educationSystem?: unknown } & Record<string, unknown>;
    if (typeof r.pack !== "string" || typeof r.educationSystem !== "string") throw new Error("Modèle attendance : `pack` et `educationSystem` sont obligatoires.");
    const { pack, templateVersion: _templateVersion, ...body } = r;
    const checked = validatePackTemplate({ ...DEFAULT_ATTENDANCE_PACK, ...body });
    if (!checked.ok) throw new Error(`Modèle attendance ${r.educationSystem}:${pack} invalide : ${checked.error.message}`);
    const key = attendanceTemplateKey(r.educationSystem, pack as string);
    if (map.has(key)) throw new Error(`Modèle attendance en double : ${key}.`);
    map.set(key, checked.value);
  }
  return map;
}

let cached: AttendanceTemplates | undefined;

/** Modèles livrés avec le module (chargés et validés une fois). */
export function defaultAttendanceTemplates(): AttendanceTemplates {
  cached ??= buildAttendanceTemplates([ciPrimary]);
  return cached;
}

/**
 * Modèle du pack pour un système éducatif ; la base (`DEFAULT_ATTENDANCE_PACK`) si le pack n'a pas de fichier propre.
 * Jamais `undefined` : un pack inconnu reçoit la base.
 */
export function getAttendancePackTemplate(educationSystem: string, pack: string, templates: AttendanceTemplates = defaultAttendanceTemplates()): AttendancePackTemplate {
  return templates.get(attendanceTemplateKey(educationSystem, pack)) ?? DEFAULT_ATTENDANCE_PACK;
}
