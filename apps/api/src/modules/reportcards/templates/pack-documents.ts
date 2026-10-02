/**
 * Gabarits GÉNÉRIQUES des documents des packs (Phase 4-5) — rendus par le service générique des documents officiels
 * (`requestOfficialDocument`) depuis un contexte d'impression FOURNI par le module propriétaire et scellé avec le document :
 *
 *   council-minutes            COUNCIL_MINUTES           PV de conseil (conseil de classe 006, conseil des maîtres 005)
 *   annual-review-primary      ANNUAL_REVIEW             bilan annuel du primaire (005)
 *   exam-convocation           EXAM_CONVOCATION          convocation à un examen (018)
 *   exam-success-certificate   EXAM_SUCCESS_CERTIFICATE  attestation de réussite à un examen (018)
 *   exam-transcript            EXAM_TRANSCRIPT           relevé de notes d'examen (018)
 *
 * et la v2 du bulletin du primaire (`primary-bulletin`, bloc compétences). Mêmes contraintes que les bulletins : aucun nom
 * d'établissement ni de personne dans le gabarit (tout vient du contexte scellé ou du branding), polices génériques, couleurs
 * `var(--primary)`, composants de plateforme, liste blanche de balises, CSS sans URL. Les rubriques officielles (en-têtes,
 * devise, mentions) sont à fournir (`regulatory-sources-needed.md`) : elles s'ajouteront comme NOUVELLES VERSIONS de gabarit.
 *
 * Marquage « règles de démonstration » : quand les résultats viennent d'un jeu fictif (`placeholder`), le service de rendu
 * ajoute au contexte `demonstration` et `demonstrationNotice` (composant `{{> footer}}`) et impose le filigrane.
 *
 * Contextes attendus (chaînes déjà mises en forme par le propriétaire ; listes bornées) — voir `domain/pack-documents.ts`.
 */
import type { SignatureSlot } from "../domain/types";
import type { BuiltinTemplate } from "./types";

const CSS = `
.doc { position: relative; padding: 0; color: #1d2433; font-family: "Georgia", "Times New Roman", serif; font-size: 10pt; line-height: 1.35; }
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.hdr-col { flex: 1; text-align: center; }
.hdr-line { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; color: var(--primary); }
.inst-name { margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; font-weight: 700; color: var(--primary); }
.inst-contact { margin-top: 2px; font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #5b6475; }
.img-logo, .img-emblem { display: block; margin: 6px auto 0; max-width: 110px; max-height: 80px; }
.header-rule { height: 3px; margin: 10px 0 14px; background: var(--primary); }
.doc-title { text-align: center; font-size: 15pt; font-weight: 700; letter-spacing: 0.05em; color: var(--primary); margin: 8px 0 3px; }
.doc-subtitle { text-align: center; font-size: 9pt; color: #5b6475; margin-bottom: 8px; }
h2 { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: var(--primary); margin: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.facts { margin: 8px 0; padding: 6px 10px; border: 1px solid #cfd6e4; border-radius: 6px; }
.fact { display: flex; gap: 10px; padding: 2px 0; }
.fact .lbl { min-width: 170px; color: #5b6475; }
.fact .val { font-weight: 700; }
.lead { text-align: center; font-size: 11pt; margin: 10px 0 4px; }
.recipient { text-align: center; font-size: 17pt; font-weight: 700; color: var(--primary); letter-spacing: 0.03em; margin: 6px 0 2px; }
.birth { text-align: center; font-size: 9.5pt; color: #3a4357; margin-bottom: 10px; }
.award { text-align: center; font-size: 13pt; font-weight: 700; margin: 8px 0; }
table.rows { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9pt; }
table.rows th { background: var(--primary); color: #ffffff; padding: 4px 6px; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; }
table.rows th.left, table.rows td.left { text-align: left; }
table.rows td { border-bottom: 1px solid #d9deea; padding: 3px 6px; text-align: center; }
.note { margin: 8px 0; font-size: 9pt; font-style: italic; color: #3a4357; }
.reference { text-align: center; margin: 8px 0; font-family: "Courier New", monospace; font-size: 9.5pt; letter-spacing: 0.04em; }
.signatures { display: flex; justify-content: space-around; gap: 16px; margin-top: 22px; }
.sig { flex: 1; text-align: center; font-size: 9pt; }
.sig-slot { font-weight: 700; color: var(--primary); text-transform: uppercase; font-size: 7.5pt; }
.sig .img-signature { display: block; margin: 4px auto; max-height: 50px; max-width: 140px; }
.sig-name { margin-top: 26px; font-weight: 700; }
.sig .img-signature + .sig-name { margin-top: 2px; }
.sig-title { color: #5b6475; font-size: 8pt; }
.verification { display: flex; align-items: center; gap: 12px; margin-top: 18px; padding-top: 8px; border-top: 1px solid #cfd6e4; font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #5b6475; }
.qr svg { width: 74px; height: 74px; display: block; }
.verif-code { font-family: "Courier New", monospace; font-size: 9pt; color: #1d2433; font-weight: 700; letter-spacing: 0.05em; }
.doc-footer { margin-top: 8px; font-size: 7.5pt; color: #5b6475; text-align: center; }
.doc-demo { margin-top: 8px; padding: 4px 8px; border: 1px dashed #b41e1e; color: #b41e1e; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; font-weight: 700; text-align: center; }
.watermark { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 72pt; font-weight: 700; color: rgba(180, 30, 30, 0.14); transform: rotate(-30deg); pointer-events: none; z-index: 5; }
`;

const OPTIONS = { type: "object", additionalProperties: false, properties: { watermark: { type: "string", maxLength: 40, default: "" } } } as const;

const SLOT_COUNCIL: readonly SignatureSlot[] = [];

const COUNCIL_MINUTES_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<div class="doc-subtitle">{{ council.kindLabel }}{{#if council.classroomLabel}} — {{ council.classroomLabel }}{{/if}}{{#if council.periodLabel}} — {{ council.periodLabel }}{{/if}}{{#if council.academicYearLabel}} — {{ council.academicYearLabel }}{{/if}}</div>
<section class="facts">
  <div class="fact"><span class="lbl">Date de la séance</span><span class="val">{{ council.heldOn | date_fr }}</span></div>
  {{#if council.place}}<div class="fact"><span class="lbl">Lieu</span><span class="val">{{ council.place }}</span></div>{{/if}}
  {{#if council.presidentName}}<div class="fact"><span class="lbl">Président(e)</span><span class="val">{{ council.presidentName }}</span></div>{{/if}}
  {{#if council.secretaryName}}<div class="fact"><span class="lbl">Secrétaire de séance</span><span class="val">{{ council.secretaryName }}</span></div>{{/if}}
  {{#if quorum.text}}<div class="fact"><span class="lbl">Quorum</span><span class="val">{{ quorum.text }}</span></div>{{/if}}
</section>
{{#if participants}}<h2>Participants</h2>
<table class="rows">
  <thead><tr><th class="left">Nom</th><th class="left">Qualité</th><th>Présence</th><th>Signature</th></tr></thead>
  <tbody>
  {{#each participants limit=200}}<tr><td class="left">{{ this.name }}</td><td class="left">{{ this.roleLabel }}</td><td>{{ this.presenceLabel }}</td><td>{{ this.signedText }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
{{#if agenda}}<h2>Ordre du jour</h2>
<ol>{{#each agenda limit=60}}<li>{{ this.title }}{{#if this.summary}} — {{ this.summary }}{{/if}}</li>{{/each}}</ol>{{/if}}
{{#if decisions}}<h2>Décisions</h2>
<table class="rows">
  <thead><tr><th>N°</th><th class="left">Élève</th><th class="left">Décision</th><th class="left">Justification</th></tr></thead>
  <tbody>
  {{#each decisions limit=1500}}<tr><td>{{ this.number }}</td><td class="left">{{ this.studentName }}</td><td class="left">{{ this.decisionLabel }}</td><td class="left">{{ this.justification }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
{{#if remarks}}<h2>Observations</h2><p>{{ remarks }}</p>{{/if}}
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const ANNUAL_REVIEW_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<section class="facts">
  <div class="fact"><span class="lbl">Élève</span><span class="val">{{ student.fullName }}</span></div>
  {{#if student.matricule}}<div class="fact"><span class="lbl">Matricule</span><span class="val">{{ student.matricule }}</span></div>{{/if}}
  {{#if student.birthDate}}<div class="fact"><span class="lbl">Né(e) le</span><span class="val">{{ student.birthDate | date_fr }}</span></div>{{/if}}
  <div class="fact"><span class="lbl">Classe</span><span class="val">{{ enrollment.classroomLabel | default:"--" }}</span></div>
  <div class="fact"><span class="lbl">Année</span><span class="val">{{ enrollment.academicYearLabel | default:"--" }}</span></div>
  {{#if enrollment.enrolledOnText}}<div class="fact"><span class="lbl">Inscrit(e)</span><span class="val">{{ enrollment.enrolledOnText }}</span></div>{{/if}}
  {{#if enrollment.stateAssignedText}}<div class="fact"><span class="lbl">Statut</span><span class="val">{{ enrollment.stateAssignedText }}</span></div>{{/if}}
</section>
{{#if periods}}<h2>Résultats de l'année</h2>
<table class="rows">
  <thead><tr><th class="left">Période</th><th>Moyenne</th><th>Rang</th></tr></thead>
  <tbody>
  {{#each periods limit=12}}<tr><td class="left">{{ this.label }}</td><td>{{ this.averageDisplay | default:"--" }}</td><td>{{ this.rankText | default:"--" }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
<section class="facts">
  {{#if result.averageDisplay}}<div class="fact"><span class="lbl">Moyenne générale annuelle</span><span class="val">{{ result.averageDisplay }}</span></div>{{/if}}
  {{#if result.rankText}}<div class="fact"><span class="lbl">Rang annuel</span><span class="val">{{ result.rankText }}</span></div>{{/if}}
  {{#if result.decisionLabel}}<div class="fact"><span class="lbl">Décision du conseil</span><span class="val">{{ result.decisionLabel }}</span></div>{{/if}}
  {{#if result.distinctionLabel}}<div class="fact"><span class="lbl">Distinction</span><span class="val">{{ result.distinctionLabel }}</span></div>{{/if}}
</section>
{{#if competencies}}<h2>Compétences</h2>
{{#if competencies.scaleLabel}}<p class="note">{{ competencies.scaleLabel }}</p>{{/if}}
<table class="rows">
  <thead><tr><th class="left">Domaine</th><th>Évaluées</th><th class="left">Niveaux</th></tr></thead>
  <tbody>
  {{#each competencies.domains limit=40}}<tr><td class="left">{{ this.label }}</td><td>{{ this.evaluated }} / {{ this.expected }}</td><td class="left">{{ this.levelsText }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
{{#if attendance}}<section class="facts"><div class="fact"><span class="lbl">Assiduité</span><span class="val">{{ attendance.text }}</span></div></section>{{/if}}
{{#if council.appreciation}}<h2>Appréciation du conseil</h2><p>{{ council.appreciation }}</p>{{/if}}
{{#if council.heldOn}}<p class="note">Conseil des maîtres du {{ council.heldOn | date_fr }}.</p>{{/if}}
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const EXAM_CONVOCATION_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<p class="lead">{{ text.convoked }}</p>
<div class="recipient">{{ candidate.fullName }}</div>
<div class="birth">{{ candidate.birthLine }}</div>
<section class="facts">
  <div class="fact"><span class="lbl">Examen</span><span class="val">{{ exam.label }}</span></div>
  {{#if exam.sessionLabel}}<div class="fact"><span class="lbl">Session</span><span class="val">{{ exam.sessionLabel }}</span></div>{{/if}}
  {{#if candidate.number}}<div class="fact"><span class="lbl">Numéro de candidat</span><span class="val">{{ candidate.number }}</span></div>{{/if}}
  {{#if centre.name}}<div class="fact"><span class="lbl">Centre</span><span class="val">{{ centre.name }}</span></div>{{/if}}
  {{#if centre.address}}<div class="fact"><span class="lbl">Adresse</span><span class="val">{{ centre.address }}</span></div>{{/if}}
  {{#if centre.room}}<div class="fact"><span class="lbl">Salle</span><span class="val">{{ centre.room }}</span></div>{{/if}}
</section>
{{#if schedule}}<h2>Calendrier des épreuves</h2>
<table class="rows">
  <thead><tr><th class="left">Date</th><th>Heure</th><th class="left">Épreuve</th><th>Durée</th></tr></thead>
  <tbody>
  {{#each schedule limit=80}}<tr><td class="left">{{ this.date | date_fr }}</td><td>{{ this.time }}</td><td class="left">{{ this.label }}</td><td>{{ this.durationText }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
{{#if instructions}}<h2>Consignes</h2>
<ul>{{#each instructions limit=30}}<li>{{ this.text }}</li>{{/each}}</ul>{{/if}}
<div class="reference">N° {{ reference }}</div>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const EXAM_SUCCESS_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<p class="lead">{{ text.certified }}</p>
<div class="recipient">{{ candidate.fullName }}</div>
<div class="birth">{{ candidate.birthLine }}</div>
<p class="lead">{{ text.succeeded }}</p>
<div class="award">{{ exam.label }}</div>
<section class="facts">
  {{#if exam.sessionLabel}}<div class="fact"><span class="lbl">Session</span><span class="val">{{ exam.sessionLabel }}</span></div>{{/if}}
  {{#if candidate.number}}<div class="fact"><span class="lbl">Numéro de candidat</span><span class="val">{{ candidate.number }}</span></div>{{/if}}
  {{#if result.mentionLabel}}<div class="fact"><span class="lbl">Mention</span><span class="val">{{ result.mentionLabel }}</span></div>{{/if}}
  {{#if result.announcedOn}}<div class="fact"><span class="lbl">Résultat proclamé le</span><span class="val">{{ result.announcedOn | date_fr }}</span></div>{{/if}}
</section>
{{#if text.validity}}<p class="note">{{ text.validity }}</p>{{/if}}
<div class="reference">N° {{ reference }}</div>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

const EXAM_TRANSCRIPT_BODY = `<section class="doc">
{{@watermark}}
{{> header}}
{{> title}}
<section class="facts">
  <div class="fact"><span class="lbl">Candidat(e)</span><span class="val">{{ candidate.fullName }}</span></div>
  {{#if candidate.birthLine}}<div class="fact"><span class="lbl">Naissance</span><span class="val">{{ candidate.birthLine }}</span></div>{{/if}}
  {{#if candidate.number}}<div class="fact"><span class="lbl">Numéro de candidat</span><span class="val">{{ candidate.number }}</span></div>{{/if}}
  <div class="fact"><span class="lbl">Examen</span><span class="val">{{ exam.label }}</span></div>
  {{#if exam.sessionLabel}}<div class="fact"><span class="lbl">Session</span><span class="val">{{ exam.sessionLabel }}</span></div>{{/if}}
</section>
{{#if papers}}<table class="rows">
  <thead><tr><th class="left">Épreuve</th><th>Coef.</th><th>Note</th><th class="left">Observation</th></tr></thead>
  <tbody>
  {{#each papers limit=60}}<tr><td class="left">{{ this.label }}</td><td>{{ this.coefficient }}</td><td>{{ this.scoreText }}</td><td class="left">{{ this.remark }}</td></tr>{{/each}}
  </tbody>
</table>{{/if}}
<section class="facts">
  {{#if summary.averageText}}<div class="fact"><span class="lbl">Moyenne</span><span class="val">{{ summary.averageText }}</span></div>{{/if}}
  {{#if summary.rankText}}<div class="fact"><span class="lbl">Rang</span><span class="val">{{ summary.rankText }}</span></div>{{/if}}
  {{#if summary.resultLabel}}<div class="fact"><span class="lbl">Résultat</span><span class="val">{{ summary.resultLabel }}</span></div>{{/if}}
  {{#if summary.mentionLabel}}<div class="fact"><span class="lbl">Mention</span><span class="val">{{ summary.mentionLabel }}</span></div>{{/if}}
</section>
{{#if text.note}}<p class="note">{{ text.note }}</p>{{/if}}
<div class="reference">N° {{ reference }}</div>
{{> signatures}}
{{> verification}}
{{> footer}}
</section>`;

export const PACK_DOCUMENT_TEMPLATES: readonly BuiltinTemplate[] = Object.freeze([
  {
    key: "council-minutes",
    version: 1,
    documentKind: "COUNCIL_MINUTES",
    pack: "CORE",
    title: "Procès-verbal de conseil (modèle générique)",
    body: COUNCIL_MINUTES_BODY,
    css: CSS,
    optionsSchema: OPTIONS,
    signatureSlots: SLOT_COUNCIL,
  },
  {
    key: "annual-review-primary",
    version: 1,
    documentKind: "ANNUAL_REVIEW",
    pack: "PRIMARY",
    title: "Bilan annuel du primaire (modèle générique)",
    body: ANNUAL_REVIEW_BODY,
    css: CSS,
    optionsSchema: OPTIONS,
    signatureSlots: SLOT_COUNCIL,
  },
  {
    key: "exam-convocation",
    version: 1,
    documentKind: "EXAM_CONVOCATION",
    pack: "CORE",
    title: "Convocation à un examen (modèle générique)",
    body: EXAM_CONVOCATION_BODY,
    css: CSS,
    optionsSchema: OPTIONS,
    signatureSlots: SLOT_COUNCIL,
  },
  {
    key: "exam-success-certificate",
    version: 1,
    documentKind: "EXAM_SUCCESS_CERTIFICATE",
    pack: "CORE",
    title: "Attestation de réussite à un examen (modèle générique)",
    body: EXAM_SUCCESS_BODY,
    css: CSS,
    optionsSchema: OPTIONS,
    signatureSlots: SLOT_COUNCIL,
  },
  {
    key: "exam-transcript",
    version: 1,
    documentKind: "EXAM_TRANSCRIPT",
    pack: "CORE",
    title: "Relevé de notes d'examen (modèle générique)",
    body: EXAM_TRANSCRIPT_BODY,
    css: CSS,
    optionsSchema: OPTIONS,
    signatureSlots: SLOT_COUNCIL,
  },
] satisfies readonly BuiltinTemplate[]);

/** Bloc « compétences » du bulletin du primaire v2 (`{{#if competencies}}` : compteurs par domaine, jamais de moyenne). */
export const PRIMARY_COMPETENCIES_BLOCK = `{{#if competencies}}<section class="summary">
  <div class="doc-subtitle">COMPÉTENCES{{#if competencies.scaleLabel}} — {{ competencies.scaleLabel }}{{/if}}</div>
  {{#each competencies.domains limit=40}}<div class="sum-row"><span class="lbl">{{ this.label }}</span><span class="val">{{ this.evaluated }} / {{ this.expected }} — {{ this.levelsText }}</span></div>{{/each}}
</section>{{/if}}`;
