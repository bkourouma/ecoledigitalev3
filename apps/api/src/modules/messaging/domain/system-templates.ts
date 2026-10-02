/**
 * Gabarits PAR DÉFAUT des messages système (le tenant les surcharge en table `system_templates`). Texte brut, variables
 * `{{nom}}`. Aucune constante réglementaire : le texte est une donnée de configuration, modifiable par établissement.
 */
export interface SystemTemplateDefinition {
  readonly code: string;
  readonly title: string;
  readonly body: string;
  readonly enabledByDefault: boolean;
  readonly variables: readonly string[];
}

export const SYSTEM_ABSENCE = "attendance.absence";
export const SYSTEM_LATE = "attendance.late";

export const DEFAULT_SYSTEM_TEMPLATES: readonly SystemTemplateDefinition[] = Object.freeze([
  {
    code: SYSTEM_ABSENCE,
    title: "Absence de {{studentName}}",
    body: "{{studentName}} a été signalé(e) absent(e) le {{date}}. Si l'absence est justifiée, merci de déposer un justificatif depuis l'espace parent.",
    enabledByDefault: true,
    variables: Object.freeze(["studentName", "date"]),
  },
  {
    code: SYSTEM_LATE,
    title: "Retard de {{studentName}}",
    body: "{{studentName}} est arrivé(e) en retard le {{date}}.",
    enabledByDefault: false,
    variables: Object.freeze(["studentName", "date"]),
  },
]);

export const findDefaultTemplate = (code: string): SystemTemplateDefinition | undefined => DEFAULT_SYSTEM_TEMPLATES.find((t) => t.code === code);
