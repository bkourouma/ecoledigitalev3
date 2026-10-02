/**
 * Gabarits GÉNÉRIQUES des documents officiels du supérieur (019) : diplôme, attestation de réussite, attestation
 * d'authenticité. Rendus par le port générique `renderDocumentPdf` avec le CONTEXTE fourni par le module `higher`
 * (`higher/domain/document-context.ts`), depuis le snapshot immuable `diploma/1`, `attestation-success/1`,
 * `attestation-authenticity/1`.
 *
 * Mêmes contraintes que les bulletins : aucun nom d'établissement ni de personne dans le gabarit (tout vient du snapshot),
 * polices génériques, couleurs `var(--primary)` du branding, composants de plateforme (`{{> header}}`, `{{> signatures}}`,
 * `{{> verification}}`…), liste blanche de balises, CSS sans URL. Un modèle officiel d'un établissement s'ajoutera comme une
 * nouvelle VERSION du gabarit, sans livraison de code.
 */
import type { BuiltinTemplate } from "./builtin";

const CSS = `
.doc { position: relative; padding: 0; color: #1d2433; font-family: "Georgia", "Times New Roman", serif; font-size: 11pt; line-height: 1.4; }
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.hdr-col { flex: 1; text-align: center; }
.hdr-line { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; color: var(--primary); }
.inst-name { margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; font-weight: 700; color: var(--primary); }
.inst-contact { margin-top: 2px; font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #5b6475; }
.img-logo, .img-emblem { display: block; margin: 6px auto 0; max-width: 120px; max-height: 90px; }
.header-rule { height: 3px; margin: 10px 0 18px; background: var(--primary); }
.doc-title { text-align: center; font-size: 26pt; font-weight: 700; letter-spacing: 0.08em; color: var(--primary); margin: 18px 0 4px; }
.doc-subtitle { text-align: center; font-size: 10pt; color: #5b6475; margin-bottom: 14px; }
.lead { text-align: center; font-size: 11.5pt; margin: 14px 0 6px; }
.recipient { text-align: center; font-size: 22pt; font-weight: 700; color: var(--primary); letter-spacing: 0.04em; margin: 8px 0 4px; }
.birth { text-align: center; font-size: 10.5pt; color: #3a4357; margin-bottom: 14px; }
.award { text-align: center; font-size: 15pt; font-weight: 700; margin: 12px 0 4px; }
.award-sub { text-align: center; font-size: 11pt; color: #3a4357; margin-bottom: 10px; }
.facts { margin: 12px auto; padding: 8px 14px; border: 1px solid #cfd6e4; border-radius: 6px; max-width: 460px; }
.fact { display: flex; gap: 10px; padding: 2px 0; }
.fact .lbl { min-width: 170px; color: #5b6475; }
.fact .val { font-weight: 700; }
table.ues { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
table.ues th { background: var(--primary); color: #ffffff; padding: 4px 6px; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; }
table.ues th.left, table.ues td.left { text-align: left; }
table.ues td { border-bottom: 1px solid #d9deea; padding: 3px 6px; text-align: center; }
.note { margin: 10px 0; font-size: 9.5pt; font-style: italic; color: #3a4357; text-align: center; }
.reference { text-align: center; margin: 10px 0; font-family: "Courier New", monospace; font-size: 10pt; letter-spacing: 0.05em; }
.signatures { display: flex; justify-content: space-around; gap: 16px; margin-top: 26px; }
.sig { flex: 1; text-align: center; font-size: 10pt; }
.sig-slot { font-weight: 700; color: var(--primary); text-transform: uppercase; font-size: 8pt; }
.sig .img-signature { display: block; margin: 4px auto; max-height: 56px; max-width: 150px; }
.sig-name { margin-top: 30px; font-weight: 700; }
.sig .img-signature + .sig-name { margin-top: 2px; }
.sig-title { color: #5b6475; font-size: 8.5pt; }
.verification { display: flex; align-items: center; gap: 12px; margin-top: 22px; padding-top: 10px; border-top: 1px solid #cfd6e4; font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #5b6475; }
.qr svg { width: 78px; height: 78px; display: block; }
.verif-code { font-family: "Courier New", monospace; font-size: 9pt; color: #1d2433; font-weight: 700; letter-spacing: 0.05em; }
.doc-footer { margin-top: 8px; font-size: 7.5pt; color: #5b6475; text-align: center; }
.watermark { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 72pt; font-weight: 700; color: rgba(180, 30, 30, 0.14); transform: rotate(-30deg); pointer-events: none; z-index: 5; }
`;

const options = {
  type: "object",
  additionalProperties: false,
  properties: { watermark: { type: "string", maxLength: 40, default: "" } },
} as const;

const DIPLOMA_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<p class="lead">{{ text.conferred }}</p>
<div class="recipient">{{ student.fullName }}</div>
<div class="birth">{{ student.birthLine }}</div>
<div class="award">{{ diploma.label }}</div>
{{#if diploma.gradeCode}}<div class="award-sub">{{ text.gradeLine }}</div>{{/if}}
<section class="facts">
  {{#if mention.label}}<div class="fact"><span class="lbl">Mention</span><span class="val">{{ mention.label }}</span></div>{{/if}}
  {{#if mention.average}}<div class="fact"><span class="lbl">Moyenne du cycle</span><span class="val">{{ mention.average }} / 20</span></div>{{/if}}
  <div class="fact"><span class="lbl">Crédits acquis</span><span class="val">{{ creditsTotal }}</span></div>
  {{#if academicYear.label}}<div class="fact"><span class="lbl">Année</span><span class="val">{{ academicYear.label }}</span></div>{{/if}}
  {{#if acquiredDate}}<div class="fact"><span class="lbl">Obtenu le</span><span class="val">{{ acquiredDate | date_fr }}</span></div>{{/if}}
</section>
{{#if ues}}<table class="ues">
  <thead><tr><th class="left">Code</th><th class="left">Unité d'enseignement</th><th>Crédits</th></tr></thead>
  <tbody>
  {{#each ues limit=300}}<tr><td class="left">{{ this.code }}</td><td class="left">{{ this.label }}</td><td>{{ this.credits }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
{{#if duplicateOf}}<p class="note">Duplicata du diplôme {{ duplicateOf }}.</p>{{/if}}
<div class="reference">N° {{ reference }}</div>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const ATTESTATION_SUCCESS_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<p class="lead">{{ text.certified }}</p>
<div class="recipient">{{ student.fullName }}</div>
<div class="birth">{{ student.birthLine }}</div>
<p class="lead">{{ text.succeeded }}</p>
<div class="award">{{ program.label }}</div>
<section class="facts">
  {{#if mention.label}}<div class="fact"><span class="lbl">Mention</span><span class="val">{{ mention.label }}</span></div>{{/if}}
  {{#if mention.average}}<div class="fact"><span class="lbl">Moyenne du cycle</span><span class="val">{{ mention.average }} / 20</span></div>{{/if}}
  <div class="fact"><span class="lbl">Crédits acquis</span><span class="val">{{ creditsTotal }}</span></div>
  {{#if academicYear.label}}<div class="fact"><span class="lbl">Dernière année</span><span class="val">{{ academicYear.label }}</span></div>{{/if}}
  {{#if acquiredDate}}<div class="fact"><span class="lbl">Dernière UE acquise le</span><span class="val">{{ acquiredDate | date_fr }}</span></div>{{/if}}
</section>
{{#if ues}}<table class="ues">
  <thead><tr><th class="left">Code</th><th class="left">Unité d'enseignement</th><th>Crédits</th></tr></thead>
  <tbody>
  {{#each ues limit=300}}<tr><td class="left">{{ this.code }}</td><td class="left">{{ this.label }}</td><td>{{ this.credits }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
<p class="note">{{ text.validity }}</p>
<div class="reference">N° {{ reference }}</div>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const ATTESTATION_AUTHENTICITY_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<p class="lead">{{ text.certified }}</p>
<div class="recipient">{{ student.fullName }}</div>
<div class="birth">{{ student.birthLine }}</div>
<p class="lead">{{ text.authentic }}</p>
<div class="award">{{ diploma.label }}</div>
<section class="facts">
  <div class="fact"><span class="lbl">Diplôme n°</span><span class="val">{{ diploma.awardReference }}</span></div>
  {{#if issueDate}}<div class="fact"><span class="lbl">Délivré le</span><span class="val">{{ issueDate | date_fr }}</span></div>{{/if}}
</section>
<div class="reference">N° {{ reference }}</div>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

export const HIGHER_DOCUMENT_TEMPLATES: readonly BuiltinTemplate[] = Object.freeze([
  {
    key: "higher-diploma",
    version: 1,
    documentKind: "DIPLOMA",
    pack: "HIGHER",
    title: "Diplôme du supérieur (modèle générique)",
    body: DIPLOMA_BODY,
    css: CSS,
    optionsSchema: options,
    signatureSlots: [
      { slot: "diploma-left", label: "Le Directeur", required: true },
      { slot: "diploma-right", label: "Le Directeur des études", required: true },
    ],
  },
  {
    key: "higher-attestation-success",
    version: 1,
    documentKind: "ATTESTATION_SUCCESS",
    pack: "HIGHER",
    title: "Attestation de réussite (modèle générique)",
    body: ATTESTATION_SUCCESS_BODY,
    css: CSS,
    optionsSchema: options,
    signatureSlots: [{ slot: "attestation-success", label: "Le Directeur des études", required: true }],
  },
  {
    key: "higher-attestation-authenticity",
    version: 1,
    documentKind: "ATTESTATION_AUTHENTICITY",
    pack: "HIGHER",
    title: "Attestation d'authenticité d'un diplôme (modèle générique)",
    body: ATTESTATION_AUTHENTICITY_BODY,
    css: CSS,
    optionsSchema: options,
    signatureSlots: [{ slot: "authenticity", label: "Le Directeur", required: true }],
  },
] satisfies readonly BuiltinTemplate[]);
