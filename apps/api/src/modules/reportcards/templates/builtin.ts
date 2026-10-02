/**
 * Gabarits GÉNÉRIQUES livrés par la plateforme (spec 013 AC5.1) : `primary-bulletin`, `secondary-bulletin`,
 * `higher-bulletin-credits`, `higher-bulletin-coef`, `transcript-credits`. Les modèles officiels (primaire, secondaire) sont à
 * fournir (`012/regulatory-sources-needed.md` §6) : ils s'ajouteront comme nouvelles VERSIONS, sans livraison de code.
 *
 * Contraintes : aucune mention « IPAM » / « IMHOTEP », aucun nom d'établissement ni de personne ; les polices sont des familles
 * génériques (Chromium embarque dans le PDF les glyphes utilisés) ; couleurs via `var(--primary)` / `var(--secondary)`
 * alimentées par le branding du tenant. Chaque gabarit est revalidé par `validateTemplate` (test unitaire) avant publication.
 */
import type { Pack, SignatureSlot, TemplateDocumentKind } from "../domain/types";
import { HIGHER_DOCUMENT_TEMPLATES } from "./higher-documents";

export interface BuiltinTemplate {
  readonly key: string;
  readonly version: number;
  readonly documentKind: TemplateDocumentKind;
  readonly pack: Pack;
  readonly title: string;
  readonly body: string;
  readonly css: string;
  readonly optionsSchema: Record<string, unknown>;
  readonly signatureSlots: readonly SignatureSlot[];
}

const COMMON_CSS = `
.doc { position: relative; padding: 0; color: #1d2433; font-family: "Georgia", "Times New Roman", serif; font-size: 9.5pt; line-height: 1.3; }
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.hdr-col { flex: 1; text-align: center; }
.hdr-line { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; font-weight: 700; text-transform: uppercase; color: var(--primary); }
.inst-name { margin-top: 6px; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; font-weight: 700; color: var(--primary); }
.inst-contact { margin-top: 2px; font-family: Arial, Helvetica, sans-serif; font-size: 6.8pt; color: #5b6475; }
.img-logo, .img-emblem { display: block; margin: 6px auto 0; max-width: 110px; max-height: 80px; }
.header-rule { height: 2px; margin: 8px 0 10px; background: var(--primary); }
.doc-title { text-align: center; font-size: 13pt; font-weight: 700; letter-spacing: 0.04em; color: var(--primary); margin: 4px 0 2px; }
.doc-subtitle { text-align: center; font-size: 8.5pt; color: #5b6475; margin-bottom: 6px; }
.student { border: 1px solid #cfd6e4; border-radius: 6px; padding: 8px 10px; margin: 8px 0; background: #f7f9fc; }
.student-name { font-size: 12pt; font-weight: 700; color: var(--primary); letter-spacing: 0.03em; padding-bottom: 4px; }
.student-grid { display: flex; flex-wrap: wrap; gap: 3px 18px; }
.cell { min-width: 150px; }
.cell.wide { min-width: 320px; }
.lbl { color: #5b6475; margin-right: 6px; }
.val { font-weight: 700; }
.italic { font-style: italic; font-weight: 400; }
.strong { font-weight: 700; }
table.grades { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9pt; }
table.grades th { background: var(--primary); color: #ffffff; padding: 4px 6px; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; }
table.grades th.left, table.grades td.left { text-align: left; }
table.grades td { border-bottom: 1px solid #d9deea; padding: 3px 6px; text-align: center; }
table.grades tr.group td { background: #e8edf6; font-weight: 700; text-align: left; border-top: 1px solid #b6c0d6; }
table.grades tr.sub td.left { padding-left: 16px; }
.summary { margin: 8px 0; padding: 6px 10px; border: 1px solid #cfd6e4; border-radius: 6px; }
.sum-row { display: flex; gap: 10px; padding: 2px 0; }
.sum-row .lbl { min-width: 150px; }
.jury { margin: 6px 0; font-style: italic; }
.signatures { display: flex; justify-content: space-around; gap: 12px; margin-top: 18px; }
.sig { flex: 1; text-align: center; font-size: 8.5pt; }
.sig-slot { font-weight: 700; color: var(--primary); text-transform: uppercase; font-size: 7.5pt; }
.sig .img-signature { display: block; margin: 4px auto; max-height: 50px; max-width: 140px; }
.sig-name { margin-top: 24px; font-weight: 700; }
.sig .img-signature + .sig-name { margin-top: 2px; }
.sig-title { color: #5b6475; font-size: 7.5pt; }
.verification { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #cfd6e4; font-family: Arial, Helvetica, sans-serif; font-size: 7pt; color: #5b6475; }
.qr svg { width: 74px; height: 74px; display: block; }
.verif-code { font-family: "Courier New", monospace; font-size: 8.5pt; color: #1d2433; font-weight: 700; letter-spacing: 0.05em; }
.doc-footer { margin-top: 8px; font-size: 7pt; color: #5b6475; text-align: center; }
.watermark { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 72pt; font-weight: 700; color: rgba(180, 30, 30, 0.14); transform: rotate(-30deg); pointer-events: none; z-index: 5; }
`;

const SIGNATURE_SLOTS_DIRECTION: readonly SignatureSlot[] = [
  { slot: "director", label: "Le Directeur", required: true },
  { slot: "head-teacher", label: "Le Responsable pédagogique", required: false },
];

const baseOptions = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties: {
    showRank: { type: "boolean", default: true },
    showClassAverage: { type: "boolean", default: false },
    showAttendance: { type: "boolean", default: true },
    showGeneralAppreciation: { type: "boolean", default: true },
    hideLateCount: { type: "boolean", default: false },
    watermark: { type: "string", maxLength: 40, default: "" },
    ...extra,
  },
});

const SECONDARY_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
{{> student}}
<table class="grades">
  <thead><tr>
    <th class="left">Discipline</th><th>Moy /20</th><th>Coef.</th><th>Moy × coef</th>{{#if options.showRank}}<th>Rang</th>{{/if}}<th class="left">Appréciation</th>
  </tr></thead>
  <tbody>
  {{#each groups}}
    {{#if this.hasLabel}}<tr class="group"><td colspan="6">{{ this.label }}</td></tr>{{/if}}
    {{#each this.rows limit=400}}
    <tr><td class="left">{{ this.label }}</td><td>{{ this.display }}</td><td>{{ this.coefficient }}</td><td>{{ this.weighted }}</td>{{#if options.showRank}}<td>{{ this.rankText }}</td>{{/if}}<td class="left">{{ this.appreciation }}</td></tr>
    {{/each}}
  {{/each}}
  {{#if summary.totalCoefficient}}<tr class="group"><td>TOTAUX</td><td></td><td>{{ summary.totalCoefficient }}</td><td>{{ summary.weightedTotal }}</td>{{#if options.showRank}}<td></td>{{/if}}<td></td></tr>{{/if}}
  </tbody>
</table>
<section class="summary">
  <div class="sum-row"><span class="lbl">Moyenne générale</span><span class="val">{{ summary.averageDisplay | default:"--" }} / 20</span></div>
  {{#if options.showRank}}<div class="sum-row"><span class="lbl">Classement</span><span class="val">{{ summary.rankText }}</span></div>{{/if}}
  {{#if options.showClassAverage}}<div class="sum-row"><span class="lbl">Moyenne de la classe</span><span class="val">{{ summary.classAverageDisplay | default:"--" }}</span></div>{{/if}}
  {{#if summary.mentionLabel}}<div class="sum-row"><span class="lbl">Mention</span><span class="val">{{ summary.mentionLabel }}</span></div>{{/if}}
  {{#each summary.distinctions}}<div class="sum-row"><span class="lbl">Distinction</span><span class="val">{{ this.value }}</span></div>{{/each}}
  {{#if options.showGeneralAppreciation}}{{> appreciation}}{{/if}}
  {{#if options.showAttendance}}{{> attendance}}{{/if}}
  {{#if summary.decisionLabel}}<div class="sum-row"><span class="lbl">Décision</span><span class="val">{{ summary.decisionLabel }}</span></div>{{/if}}
</section>
{{#if annual}}<section class="summary">
  <div class="doc-subtitle">BILAN ANNUEL</div>
  {{#each annual.rows}}<div class="sum-row"><span class="lbl">{{ this.label }}</span><span class="val">{{ this.display | default:"--" }} {{ this.weight }}</span></div>{{/each}}
  <div class="sum-row"><span class="lbl">Moyenne annuelle</span><span class="val">{{ annual.averageDisplay | default:"--" }}</span></div>
  <div class="sum-row"><span class="lbl">Classement annuel</span><span class="val">{{ annual.rankText }}</span></div>
  {{#if annual.decisionLabel}}<div class="sum-row"><span class="lbl">Décision de fin d'année</span><span class="val">{{ annual.decisionLabel }}</span></div>{{/if}}
</section>{{/if}}
{{> jury}}
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const PRIMARY_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
{{> student}}
<table class="grades">
  <thead><tr><th class="left">Matière</th><th>Note</th>{{#if options.showRank}}<th>Rang</th>{{/if}}<th class="left">Appréciation</th></tr></thead>
  <tbody>
  {{#each groups}}
    {{#if this.hasLabel}}<tr class="group"><td colspan="4">{{ this.label }}</td></tr>{{/if}}
    {{#each this.rows limit=400}}
    <tr><td class="left">{{ this.label }}</td><td>{{ this.display }}</td>{{#if options.showRank}}<td>{{ this.rankText }}</td>{{/if}}<td class="left">{{ this.appreciation }}</td></tr>
    {{/each}}
  {{/each}}
  </tbody>
</table>
<section class="summary">
  <div class="sum-row"><span class="lbl">Moyenne</span><span class="val">{{ summary.averageDisplay | default:"--" }}</span></div>
  {{#if options.showRank}}<div class="sum-row"><span class="lbl">Rang</span><span class="val">{{ summary.rankText }}</span></div>{{/if}}
  {{#if options.showClassAverage}}<div class="sum-row"><span class="lbl">Moyenne de la classe</span><span class="val">{{ summary.classAverageDisplay | default:"--" }}</span></div>{{/if}}
  {{#if summary.mentionLabel}}<div class="sum-row"><span class="lbl">Mention</span><span class="val">{{ summary.mentionLabel }}</span></div>{{/if}}
  {{#if options.showGeneralAppreciation}}{{> appreciation}}{{/if}}
  {{#if options.showAttendance}}{{> attendance}}{{/if}}
  {{#if summary.decisionLabel}}<div class="sum-row"><span class="lbl">Décision</span><span class="val">{{ summary.decisionLabel }}</span></div>{{/if}}
</section>
{{> jury}}
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const HIGHER_CREDITS_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
{{> student}}
{{#if deliberation}}<p class="jury">Le jury, vu le procès-verbal de délibération {{ deliberation.natureLabel }} en date du {{ deliberation.heldOn | date_fr }}, déclare que l'étudiant(e) a obtenu les résultats suivants.</p>{{/if}}
<table class="grades">
  <thead><tr><th class="left">Code</th><th class="left">Intitulé</th><th>Crédits</th><th>Note /20</th>{{#if options.showSession}}<th>Session</th>{{/if}}<th>Résultat</th></tr></thead>
  <tbody>
  {{#each groups}}
    {{#if this.header}}<tr class="group"><td class="left">{{ this.header.code }}</td><td class="left">{{ this.header.label }}</td><td>{{ this.header.credits }}</td><td>{{ this.header.display }}</td>{{#if options.showSession}}<td>{{ this.header.session }}</td>{{/if}}<td>{{ this.header.stateLabel }}</td></tr>{{/if}}
    {{#each this.rows limit=400}}
    <tr class="sub"><td class="left">{{ this.code }}</td><td class="left">{{ this.label }}</td><td>{{ this.credits }}</td><td>{{ this.display }}</td>{{#if options.showSession}}<td>{{ this.session }}</td>{{/if}}<td>{{ this.stateLabel }}</td></tr>
    {{/each}}
  {{/each}}
  </tbody>
</table>
<section class="summary">
  <div class="sum-row"><span class="lbl">Moyenne</span><span class="val">{{ summary.averageDisplay | default:"--" }} / 20</span></div>
  {{#if summary.hasCredits}}<div class="sum-row"><span class="lbl">Crédits</span><span class="val">{{ summary.creditsAcquired | default:"0" }} acquis sur {{ summary.creditsRequired | default:"--" }}</span></div>{{/if}}
  {{#if options.showRank}}<div class="sum-row"><span class="lbl">Classement</span><span class="val">{{ summary.rankText }}</span></div>{{/if}}
  {{#if summary.mentionLabel}}<div class="sum-row"><span class="lbl">Mention</span><span class="val">{{ summary.mentionLabel }}</span></div>{{/if}}
  {{#if options.showGeneralAppreciation}}{{> appreciation}}{{/if}}
  {{#if options.showAttendance}}{{> attendance}}{{/if}}
  {{#if summary.decisionLabel}}<div class="sum-row"><span class="lbl">Décision finale</span><span class="val">{{ summary.decisionLabel }}</span></div>{{/if}}
</section>
<p class="jury">NB : la décision s'obtient par rapport au total des crédits obtenus.</p>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const HIGHER_COEF_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
{{> student}}
<table class="grades">
  <thead><tr><th class="left">Unité / matière</th><th>Moy /20</th><th>Coef.</th><th>Moy × coef</th>{{#if options.showRank}}<th>Rang</th>{{/if}}<th class="left">Appréciation</th></tr></thead>
  <tbody>
  {{#each groups}}
    {{#if this.header}}<tr class="group"><td class="left">{{ this.header.label }}</td><td>{{ this.header.display }}</td><td>{{ this.header.coefficient }}</td><td>{{ this.header.weighted }}</td>{{#if options.showRank}}<td>{{ this.header.rankText }}</td>{{/if}}<td class="left">{{ this.header.appreciation }}</td></tr>{{/if}}
    {{#each this.rows limit=400}}
    <tr class="sub"><td class="left">{{ this.label }}</td><td>{{ this.display }}</td><td>{{ this.coefficient }}</td><td>{{ this.weighted }}</td>{{#if options.showRank}}<td>{{ this.rankText }}</td>{{/if}}<td class="left">{{ this.appreciation }}</td></tr>
    {{/each}}
  {{/each}}
  </tbody>
</table>
<section class="summary">
  <div class="sum-row"><span class="lbl">Moyenne générale</span><span class="val">{{ summary.averageDisplay | default:"--" }} / 20</span></div>
  {{#if options.showRank}}<div class="sum-row"><span class="lbl">Classement</span><span class="val">{{ summary.rankText }}</span></div>{{/if}}
  {{#if options.showClassAverage}}<div class="sum-row"><span class="lbl">Moyenne de la classe</span><span class="val">{{ summary.classAverageDisplay | default:"--" }}</span></div>{{/if}}
  {{#if summary.mentionLabel}}<div class="sum-row"><span class="lbl">Mention</span><span class="val">{{ summary.mentionLabel }}</span></div>{{/if}}
  {{#if options.showGeneralAppreciation}}{{> appreciation}}{{/if}}
  {{#if options.showAttendance}}{{> attendance}}{{/if}}
  {{#if summary.decisionLabel}}<div class="sum-row"><span class="lbl">Décision</span><span class="val">{{ summary.decisionLabel }}</span></div>{{/if}}
</section>
{{> jury}}
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const TRANSCRIPT_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
{{> student}}
<table class="grades">
  <thead><tr><th class="left">Période</th><th class="left">Code</th><th class="left">Intitulé</th><th>Crédits</th><th>Note /20</th><th>Résultat</th></tr></thead>
  <tbody>
  {{#each rows limit=1500}}
    <tr><td class="left">{{ this.periodLabel }}</td><td class="left">{{ this.code }}</td><td class="left">{{ this.label }}</td><td>{{ this.credits }}</td><td>{{ this.display }}</td><td>{{ this.stateLabel }}</td></tr>
  {{/each}}
  </tbody>
</table>
<section class="summary">
  {{#if summary.hasCredits}}<div class="sum-row"><span class="lbl">Crédits capitalisés</span><span class="val">{{ summary.creditsAcquired | default:"0" }}</span></div>{{/if}}
  {{#if summary.averageDisplay}}<div class="sum-row"><span class="lbl">Moyenne cumulée</span><span class="val">{{ summary.averageDisplay }} / 20</span></div>{{/if}}
  {{#if summary.mentionLabel}}<div class="sum-row"><span class="lbl">Mention</span><span class="val">{{ summary.mentionLabel }}</span></div>{{/if}}
</section>
<p class="jury">Relevé établi à la date d'émission indiquée ci-dessous.</p>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = Object.freeze([
  {
    key: "primary-bulletin",
    version: 1,
    documentKind: "REPORT_CARD",
    pack: "PRIMARY",
    title: "Bulletin du primaire (modèle générique)",
    body: PRIMARY_BODY,
    css: COMMON_CSS,
    optionsSchema: baseOptions(),
    signatureSlots: SIGNATURE_SLOTS_DIRECTION,
  },
  {
    key: "secondary-bulletin",
    version: 1,
    documentKind: "REPORT_CARD",
    pack: "SECONDARY",
    title: "Bulletin du secondaire (modèle générique)",
    body: SECONDARY_BODY,
    css: COMMON_CSS,
    optionsSchema: baseOptions(),
    signatureSlots: SIGNATURE_SLOTS_DIRECTION,
  },
  {
    key: "higher-bulletin-credits",
    version: 1,
    documentKind: "REPORT_CARD",
    pack: "HIGHER",
    title: "Relevé de notes du supérieur — crédits (modèle générique)",
    body: HIGHER_CREDITS_BODY,
    css: COMMON_CSS,
    optionsSchema: baseOptions({ showSession: { type: "boolean", default: true } }),
    signatureSlots: [
      { slot: "director-studies", label: "Le Directeur des études", required: true },
      { slot: "director", label: "Le Directeur", required: false },
    ],
  },
  {
    key: "higher-bulletin-coef",
    version: 1,
    documentKind: "REPORT_CARD",
    pack: "HIGHER",
    title: "Bulletin du supérieur — coefficients (modèle générique)",
    body: HIGHER_COEF_BODY,
    css: COMMON_CSS,
    optionsSchema: baseOptions(),
    signatureSlots: SIGNATURE_SLOTS_DIRECTION,
  },
  {
    key: "transcript-credits",
    version: 1,
    documentKind: "TRANSCRIPT",
    pack: "HIGHER",
    title: "Relevé cumulé de crédits (modèle générique)",
    body: TRANSCRIPT_BODY,
    css: COMMON_CSS,
    optionsSchema: baseOptions(),
    signatureSlots: [{ slot: "director-studies", label: "Le Directeur des études", required: true }],
  },
] satisfies readonly BuiltinTemplate[]);

/**
 * Gabarits livrés pour les documents d'AUTRES modules (diplômes et attestations du supérieur, 019) : publiés avec les
 * bulletins (`ensureBuiltinTemplates`) mais hors de la liste des bulletins (contexte fourni par l'appelant, pas un snapshot).
 */
export const PLATFORM_DOCUMENT_TEMPLATES: readonly BuiltinTemplate[] = HIGHER_DOCUMENT_TEMPLATES;

/** Tous les gabarits que la plateforme publie. */
export const ALL_PLATFORM_TEMPLATES: readonly BuiltinTemplate[] = Object.freeze([...BUILTIN_TEMPLATES, ...PLATFORM_DOCUMENT_TEMPLATES]);

/** Dernier gabarit livré pour une clé (les versions suivantes s'ajoutent à la fin de la liste). */
export function builtinTemplate(key: string): BuiltinTemplate | undefined {
  return [...BUILTIN_TEMPLATES].filter((t) => t.key === key).sort((a, b) => b.version - a.version)[0];
}

/** Gabarit par défaut proposé pour (nature de document, pack) — la configuration du tenant le remplace. */
export function defaultTemplateKey(documentKind: "REPORT_CARD" | "TRANSCRIPT", pack: Pack): string | null {
  if (documentKind === "TRANSCRIPT") return "transcript-credits";
  switch (pack) {
    case "PRIMARY": return "primary-bulletin";
    case "SECONDARY": return "secondary-bulletin";
    case "HIGHER": return "higher-bulletin-credits";
    default: return null;
  }
}
