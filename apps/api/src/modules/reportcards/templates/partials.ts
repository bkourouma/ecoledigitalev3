/**
 * Composants de PLATEFORME (`{{> nom}}`) partagés par les gabarits livrés : en-tête, bloc élève, signatures, vérification.
 * Du code revu, jamais fourni par un tenant. Les libellés génériques (« Moyenne générale », « Décision »…) sont de la
 * présentation française ; AUCUN nom d'établissement ni de personne (l'identité vient du snapshot).
 */
export const PARTIAL_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  header: `<header class="doc-header">
  <div class="hdr-col hdr-left">
    {{#each institution.headerLeft}}<div class="hdr-line">{{ this.value }}</div>{{/each}}
    {{@image logo}}
  </div>
  <div class="hdr-col hdr-right">
    {{#each institution.headerRight}}<div class="hdr-line">{{ this.value }}</div>{{/each}}
    {{@image emblem}}
    <div class="inst-name">{{ institution.legalName | upper }}</div>
    {{#if institution.contactLine}}<div class="inst-contact">{{ institution.contactLine }}</div>{{/if}}
    {{#if institution.registrationRef}}<div class="inst-contact">{{ institution.registrationRef }}</div>{{/if}}
  </div>
</header>
<div class="header-rule"></div>`,

  title: `<div class="doc-title">{{ title | upper }}</div>
{{#if meta.versionText}}<div class="doc-subtitle">{{ meta.versionText }}</div>{{/if}}`,

  student: `<section class="student">
  <div class="student-name">{{ student.fullName }}</div>
  <div class="student-grid">
    <div class="cell"><span class="lbl">Né(e) le</span><span class="val">{{ student.birthDate | date_fr | default:"--" }}</span></div>
    <div class="cell"><span class="lbl">Lieu</span><span class="val">{{ student.birthPlace | default:"--" }}</span></div>
    <div class="cell"><span class="lbl">Nationalité</span><span class="val">{{ student.nationality | upper | default:"--" }}</span></div>
    <div class="cell"><span class="lbl">Matricule</span><span class="val">{{ student.matricule | default:"--" }}</span></div>
    {{#unless isTranscript}}
    <div class="cell"><span class="lbl">Classe</span><span class="val">{{ enrollment.classroomLabel | default:"--" }}</span></div>
    <div class="cell"><span class="lbl">Niveau</span><span class="val">{{ enrollment.levelLabel | default:"--" }}</span></div>
    {{#if enrollment.programLabel}}<div class="cell wide"><span class="lbl">Filière</span><span class="val">{{ enrollment.programLabel }}</span></div>{{/if}}
    <div class="cell"><span class="lbl">Effectif</span><span class="val">{{ enrollment.classSize | default:"--" }}</span></div>
    {{#if student.repeatingText}}<div class="cell"><span class="lbl">Redoublant(e)</span><span class="val">{{ student.repeatingText }}</span></div>{{/if}}
    {{/unless}}
  </div>
</section>`,

  jury: `{{#if deliberation}}<p class="jury">Vu le procès-verbal de délibération {{ deliberation.natureLabel }} en date du {{ deliberation.heldOn | date_fr }}.</p>{{/if}}`,

  attendance: `{{#if attendance}}<div class="sum-row"><span class="lbl">Assiduité</span><span class="val">Absences justifiées : {{ attendance.justified }} — non justifiées : {{ attendance.unjustified }}{{#unless options.hideLateCount}} — retards : {{ attendance.lateCount }}{{/unless}}</span></div>{{/if}}`,

  appreciation: `{{#if appreciation}}<div class="sum-row"><span class="lbl">Appréciation</span><span class="val italic">{{ appreciation }}</span></div>{{/if}}`,

  signatures: `{{#if signatories}}<section class="signatures">
  {{#each signatories}}<div class="sig">
    <div class="sig-slot">{{ this.slotLabel }}</div>
    {{@image signature}}
    <div class="sig-name">{{ this.name }}</div>
    {{#if this.title}}<div class="sig-title">{{ this.title }}</div>{{/if}}
    {{#if this.jobFunction}}<div class="sig-title">{{ this.jobFunction }}</div>{{/if}}
  </div>{{/each}}
</section>{{/if}}`,

  verification: `<section class="verification">
  {{#if meta.hasQr}}<div class="qr">{{@qr}}</div>
  <div class="verif-text">
    <div>Document authentique vérifiable en ligne</div>
    <div class="verif-code">Code : {{ meta.code }}</div>
    <div class="verif-url">{{ meta.verifyUrl }}</div>
    <div>Émis le {{ meta.issuedAt | datetime_fr }}</div>
  </div>{{else}}<div class="verif-text"><div>Émis le {{ meta.issuedAt | datetime_fr }}</div>{{#if provisional}}<div>Document provisoire : non vérifiable.</div>{{/if}}</div>{{/if}}
</section>`,

  footer: `{{#if institution.footerText}}<footer class="doc-footer">{{ institution.footerText }}</footer>{{/if}}`,
});
