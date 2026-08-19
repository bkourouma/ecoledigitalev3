/**
 * Catalogue des modèles d'email de la messagerie.
 *
 * Un modèle = un cas d'envoi précis, dans un profil précis (administration,
 * enseignant, parent, étudiant). Chacun est personnalisable par établissement
 * et rendu dans la coquille IPAM par `message-email-templates.ts`.
 *
 * Ce fichier ne contient que des données : types et moteur de rendu vivent
 * dans `message-email-templates.ts`, qui ré-exporte tout ce qui est public.
 */

export const IPAM_GREEN = "#14532D";

/** Profil de l'expéditeur — sert au regroupement dans l'interface d'admin. */
export type MessageTemplateProfile = "admin" | "teacher" | "parent" | "student";

export const MESSAGE_TEMPLATE_PROFILE_LABELS: Record<MessageTemplateProfile, string> = {
  admin: "Administration",
  teacher: "Enseignant",
  parent: "Parent",
  student: "Étudiant",
};

/** Un type d'envoi = un modèle personnalisable. */
export type MessageTemplateKind =
  // Administration
  | "admin_parent_new"
  | "admin_parent_reply"
  | "admin_parent_bulk"
  | "admin_teacher"
  | "admin_student"
  // Enseignant
  | "teacher_parent"
  | "teacher_parent_bulk"
  | "teacher_establishment"
  | "teacher_student"
  // Parent
  | "parent_teacher_new"
  | "parent_teacher_reply"
  | "parent_school_new"
  | "parent_school_reply"
  // Étudiant
  | "student_teacher_new"
  | "student_teacher_reply"
  | "student_school";

export interface MessageEmailTemplate {
  subject: string;
  body: string;
}

export interface MessageTemplateVariable {
  key: string;
  label: string;
}

export interface MessageTemplateDefinition {
  kind: MessageTemplateKind;
  profile: MessageTemplateProfile;
  label: string;
  description: string;
  /** Couleur d'accent de l'en-tête de l'email (charte par type d'envoi). */
  accent: string;
  /**
   * Nom de variable « métier » qui double `recipientName` : un modèle destiné
   * à un parent expose `{{parentName}}`, à un enseignant `{{teacherName}}`…
   */
  recipientAlias?: string;
  /** Idem côté expéditeur (`{{teacherName}}` dans un message enseignant → parent). */
  senderAlias?: string;
  variables: MessageTemplateVariable[];
  defaults: MessageEmailTemplate;
  /** Jeu de valeurs de démonstration pour l'aperçu et l'email de test. */
  sample: Record<string, string>;
}

/* --------------------------------------------------------------------------
 * Briques communes
 * ------------------------------------------------------------------------ */

const COMMON_VARIABLES: MessageTemplateVariable[] = [
  { key: "schoolName", label: "Nom de l'établissement" },
  { key: "instituteName", label: "Nom complet de l'institut" },
  { key: "subject", label: "Sujet du message" },
  { key: "message", label: "Contenu du message" },
  { key: "senderName", label: "Nom de l'expéditeur" },
  { key: "recipientName", label: "Nom du destinataire" },
  { key: "sentAt", label: "Date et heure d'envoi" },
  { key: "priority", label: "Niveau de priorité" },
  { key: "portalUrl", label: "Lien vers l'espace en ligne" },
];

/** Assemble la liste de variables d'un modèle : les spécifiques puis les communes. */
function variables(...specific: MessageTemplateVariable[]): MessageTemplateVariable[] {
  return [...specific, ...COMMON_VARIABLES];
}

const V = {
  parentName: { key: "parentName", label: "Nom du parent" },
  childName: { key: "childName", label: "Nom de l'élève concerné" },
  teacherName: { key: "teacherName", label: "Nom de l'enseignant" },
  studentName: { key: "studentName", label: "Nom de l'étudiant" },
  adminName: { key: "adminName", label: "Nom du destinataire à l'administration" },
  conversationSubject: { key: "conversationSubject", label: "Sujet de la conversation" },
  className: { key: "className", label: "Classe concernée" },
} satisfies Record<string, MessageTemplateVariable>;

/** Bloc HTML réutilisé par les modèles par défaut pour présenter le message. */
const MESSAGE_BLOCK = `<div class="message-card">
  <p class="message-subject">{{subject}}</p>
  <div class="message-body">{{message}}</div>
</div>`;

const SIGNATURE_BLOCK = `<p class="signature">Cordialement,<br><strong>{{senderName}}</strong></p>`;

const CTA_BLOCK = `<p class="cta-wrapper"><a class="btn" href="{{portalUrl}}">Consulter dans mon espace</a></p>`;

/* --------------------------------------------------------------------------
 * Modèles — Administration
 * ------------------------------------------------------------------------ */

const ADMIN_DEFINITIONS: MessageTemplateDefinition[] = [
  {
    kind: "admin_parent_new",
    profile: "admin",
    label: "Nouvelle conversation avec un parent",
    description:
      "Envoyé au parent lorsque l'administration ouvre une nouvelle conversation à propos d'un élève.",
    accent: IPAM_GREEN,
    recipientAlias: "parentName",
    variables: variables(V.parentName, V.childName),
    defaults: {
      subject: "{{subject}}",
      body: `<p>Bonjour {{parentName}},</p>

<p>L'administration de l'établissement vous a adressé un nouveau message
concernant <strong>{{childName}}</strong>.</p>

${MESSAGE_BLOCK}

<p>Vous pouvez répondre directement depuis votre espace parent&nbsp;; votre réponse sera
transmise à l'administration.</p>

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Mme Aya Koffi",
      childName: "Kouassi Koffi",
      subject: "Réunion de rentrée",
      message:
        "La réunion de rentrée se tiendra le samedi 14 septembre à 9h00 dans l'amphithéâtre A. Votre présence est vivement souhaitée.",
    },
  },
  {
    kind: "admin_parent_reply",
    profile: "admin",
    label: "Réponse dans une conversation parent",
    description: "Envoyé au parent quand l'administration répond dans une conversation déjà ouverte.",
    accent: "#0F766E",
    recipientAlias: "parentName",
    variables: variables(V.parentName, V.childName, V.conversationSubject),
    defaults: {
      subject: "Re : {{conversationSubject}}",
      body: `<p>Bonjour {{parentName}},</p>

<p>L'administration de l'établissement a répondu à votre conversation
« {{conversationSubject}} » concernant <strong>{{childName}}</strong>.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Mme Aya Koffi",
      childName: "Kouassi Koffi",
      conversationSubject: "Absence du 12 mai",
      subject: "Absence du 12 mai",
      message:
        "Nous avons bien reçu votre justificatif, l'absence a été régularisée dans le dossier de votre enfant.",
    },
  },
  {
    kind: "admin_parent_bulk",
    profile: "admin",
    label: "Envoi groupé aux parents",
    description: "Envoyé à chaque parent lors d'une diffusion par classe(s) ou par sélection d'élèves.",
    accent: "#7C3AED",
    recipientAlias: "parentName",
    variables: variables(V.parentName, V.childName),
    defaults: {
      subject: "Communication : {{subject}}",
      body: `<p>Bonjour {{parentName}},</p>

<p>L'établissement adresse la communication suivante aux parents des élèves concernés.
Ce message vous est transmis au titre de <strong>{{childName}}</strong>.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "M. Ibrahim Traoré",
      childName: "Fatoumata Traoré",
      subject: "Fermeture exceptionnelle",
      message:
        "L'établissement sera exceptionnellement fermé le vendredi 3 octobre pour travaux. Les cours reprendront le lundi suivant selon l'emploi du temps habituel.",
    },
  },
  {
    kind: "admin_teacher",
    profile: "admin",
    label: "Message aux enseignants",
    description: "Envoyé aux enseignants destinataires d'un message de l'administration.",
    accent: "#1D4ED8",
    recipientAlias: "teacherName",
    variables: variables(V.teacherName),
    defaults: {
      subject: "{{subject}}",
      body: `<p>Bonjour {{teacherName}},</p>

<p>L'administration de l'établissement vous adresse le message suivant
(priorité&nbsp;: {{priority}}).</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "M. Serge N'Guessan",
      subject: "Remise des notes du semestre",
      message:
        "Merci de saisir l'ensemble des notes du premier semestre avant le vendredi 20 décembre, délai de rigueur pour la tenue des jurys.",
    },
  },
  {
    kind: "admin_student",
    profile: "admin",
    label: "Annonce aux étudiants",
    description: "Envoyé aux étudiants destinataires d'une annonce de l'administration.",
    accent: "#B45309",
    recipientAlias: "studentName",
    variables: variables(V.studentName),
    defaults: {
      subject: "Annonce : {{subject}}",
      body: `<p>Bonjour {{studentName}},</p>

<p>L'établissement publie l'annonce suivante à votre attention
(priorité&nbsp;: {{priority}}).</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Aminata Diallo",
      subject: "Ouverture des inscriptions aux examens",
      message:
        "Les inscriptions aux examens de fin de semestre sont ouvertes jusqu'au 30 novembre. Rendez-vous à la scolarité muni de votre carte d'étudiant.",
    },
  },
];

/* --------------------------------------------------------------------------
 * Modèles — Enseignant
 * ------------------------------------------------------------------------ */

const TEACHER_DEFINITIONS: MessageTemplateDefinition[] = [
  {
    kind: "teacher_parent",
    profile: "teacher",
    label: "Message d'un enseignant à un parent",
    description: "Envoyé au parent quand un enseignant lui écrit au sujet de son enfant.",
    accent: "#1D4ED8",
    recipientAlias: "parentName",
    senderAlias: "teacherName",
    variables: variables(V.parentName, V.childName, V.teacherName),
    defaults: {
      subject: "{{subject}} — {{childName}}",
      body: `<p>Bonjour {{parentName}},</p>

<p><strong>{{teacherName}}</strong> vous adresse un message concernant
<strong>{{childName}}</strong> (priorité&nbsp;: {{priority}}).</p>

${MESSAGE_BLOCK}

<p>Vous pouvez répondre depuis votre espace parent&nbsp;; votre réponse parviendra
directement à l'enseignant.</p>

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Mme Aya Koffi",
      senderName: "M. Serge N'Guessan",
      childName: "Kouassi Koffi",
      subject: "Travail en classe",
      message:
        "Kouassi montre de réels progrès en mathématiques ce trimestre. Je l'encourage à poursuivre ses efforts sur les exercices de géométrie.",
    },
  },
  {
    kind: "teacher_parent_bulk",
    profile: "teacher",
    label: "Envoi groupé d'un enseignant aux parents",
    description: "Envoyé à chaque parent lors d'une diffusion par classe ou par sélection d'élèves.",
    accent: "#0369A1",
    recipientAlias: "parentName",
    senderAlias: "teacherName",
    variables: variables(V.parentName, V.childName, V.teacherName),
    defaults: {
      subject: "{{subject}}",
      body: `<p>Bonjour {{parentName}},</p>

<p><strong>{{teacherName}}</strong> adresse la communication suivante aux parents de la
classe. Ce message vous est transmis au titre de <strong>{{childName}}</strong>.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "M. Ibrahim Traoré",
      senderName: "Mme Clarisse Assi",
      childName: "Fatoumata Traoré",
      subject: "Sortie pédagogique du 18 mars",
      message:
        "Une sortie pédagogique est organisée le 18 mars au port autonome. Merci de retourner l'autorisation signée avant le 12 mars.",
    },
  },
  {
    kind: "teacher_establishment",
    profile: "teacher",
    label: "Message d'un enseignant à l'administration",
    description: "Envoyé aux administrateurs quand un enseignant écrit à l'établissement.",
    accent: "#7C3AED",
    recipientAlias: "adminName",
    senderAlias: "teacherName",
    variables: variables(V.adminName, V.teacherName),
    defaults: {
      subject: "[Enseignant → Établissement] {{subject}}",
      body: `<p>Bonjour {{adminName}},</p>

<p><strong>{{teacherName}}</strong>, enseignant(e) de l'établissement, adresse le message
suivant à l'administration.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

<p class="signature">Message transmis automatiquement depuis l'espace enseignant.</p>`,
    },
    sample: {
      recipientName: "Service scolarité",
      senderName: "M. Serge N'Guessan",
      subject: "Demande de salle pour un rattrapage",
      message:
        "Je souhaiterais réserver une salle le samedi 22 mars de 9h à 12h pour un cours de rattrapage destiné aux étudiants de L2.",
    },
  },
  {
    kind: "teacher_student",
    profile: "teacher",
    label: "Message d'un enseignant aux étudiants",
    description: "Envoyé aux étudiants destinataires d'un message de leur enseignant.",
    accent: "#B45309",
    recipientAlias: "studentName",
    senderAlias: "teacherName",
    variables: variables(V.studentName, V.teacherName, V.className),
    defaults: {
      subject: "{{subject}}",
      body: `<p>Bonjour {{studentName}},</p>

<p><strong>{{teacherName}}</strong> vous adresse le message suivant.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Aminata Diallo",
      senderName: "Mme Clarisse Assi",
      className: "L2 Gestion A",
      subject: "Documents du prochain TD",
      message:
        "Les supports du TD de jeudi sont déposés dans l'espace de cours. Merci de les avoir lus avant la séance.",
    },
  },
];

/* --------------------------------------------------------------------------
 * Modèles — Parent
 * ------------------------------------------------------------------------ */

const PARENT_DEFINITIONS: MessageTemplateDefinition[] = [
  {
    kind: "parent_teacher_new",
    profile: "parent",
    label: "Nouvelle conversation parent → enseignant",
    description: "Envoyé à l'enseignant quand un parent ouvre une conversation à propos de son enfant.",
    accent: "#0F766E",
    recipientAlias: "teacherName",
    senderAlias: "parentName",
    variables: variables(V.teacherName, V.parentName, V.childName),
    defaults: {
      subject: "Message d'un parent : {{subject}}",
      body: `<p>Bonjour {{teacherName}},</p>

<p><strong>{{parentName}}</strong>, parent de <strong>{{childName}}</strong>, vous a adressé
un message depuis son espace.</p>

${MESSAGE_BLOCK}

<p>Votre réponse depuis l'espace enseignant sera transmise au parent.</p>

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "M. Serge N'Guessan",
      senderName: "Mme Aya Koffi",
      childName: "Kouassi Koffi",
      subject: "Difficultés en mathématiques",
      message:
        "Bonjour, Kouassi rencontre des difficultés sur le chapitre des fonctions. Serait-il possible d'échanger sur les points à retravailler à la maison ?",
    },
  },
  {
    kind: "parent_teacher_reply",
    profile: "parent",
    label: "Réponse d'un parent à un enseignant",
    description: "Envoyé à l'enseignant quand un parent répond dans une conversation existante.",
    accent: "#047857",
    recipientAlias: "teacherName",
    senderAlias: "parentName",
    variables: variables(V.teacherName, V.parentName, V.childName, V.conversationSubject),
    defaults: {
      subject: "Re : {{conversationSubject}}",
      body: `<p>Bonjour {{teacherName}},</p>

<p><strong>{{parentName}}</strong> a répondu dans la conversation
« {{conversationSubject}} » concernant <strong>{{childName}}</strong>.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "M. Serge N'Guessan",
      senderName: "Mme Aya Koffi",
      childName: "Kouassi Koffi",
      conversationSubject: "Difficultés en mathématiques",
      subject: "Difficultés en mathématiques",
      message: "Merci pour vos conseils, nous mettrons en place le planning de révision dès cette semaine.",
    },
  },
  {
    kind: "parent_school_new",
    profile: "parent",
    label: "Message d'un parent à l'établissement",
    description: "Envoyé aux administrateurs quand un parent écrit à l'établissement.",
    accent: "#7C3AED",
    recipientAlias: "adminName",
    senderAlias: "parentName",
    variables: variables(V.adminName, V.parentName, V.childName),
    defaults: {
      subject: "[Parent → Établissement] {{subject}} — {{childName}}",
      body: `<p>Bonjour {{adminName}},</p>

<p><strong>{{parentName}}</strong>, parent de <strong>{{childName}}</strong>, adresse le
message suivant à l'administration de l'établissement.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

<p class="signature">Message transmis automatiquement depuis l'espace parent.</p>`,
    },
    sample: {
      recipientName: "Service scolarité",
      senderName: "Mme Aya Koffi",
      childName: "Kouassi Koffi",
      subject: "Attestation de scolarité",
      message:
        "Bonjour, je souhaiterais obtenir une attestation de scolarité pour mon fils, à présenter à mon employeur.",
    },
  },
  {
    kind: "parent_school_reply",
    profile: "parent",
    label: "Réponse d'un parent à l'établissement",
    description: "Envoyé aux administrateurs quand un parent répond dans une conversation existante.",
    accent: "#6D28D9",
    recipientAlias: "adminName",
    senderAlias: "parentName",
    variables: variables(V.adminName, V.parentName, V.childName, V.conversationSubject),
    defaults: {
      subject: "Re : {{conversationSubject}} — {{parentName}}",
      body: `<p>Bonjour {{adminName}},</p>

<p><strong>{{parentName}}</strong> a répondu dans la conversation
« {{conversationSubject}} » concernant <strong>{{childName}}</strong>.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

<p class="signature">Message transmis automatiquement depuis l'espace parent.</p>`,
    },
    sample: {
      recipientName: "Service scolarité",
      senderName: "Mme Aya Koffi",
      childName: "Kouassi Koffi",
      conversationSubject: "Attestation de scolarité",
      subject: "Attestation de scolarité",
      message: "Merci, j'ai bien reçu le document. Bonne journée.",
    },
  },
];

/* --------------------------------------------------------------------------
 * Modèles — Étudiant
 * ------------------------------------------------------------------------ */

const STUDENT_DEFINITIONS: MessageTemplateDefinition[] = [
  {
    kind: "student_teacher_new",
    profile: "student",
    label: "Message d'un étudiant à un enseignant",
    description: "Envoyé à l'enseignant quand un étudiant lui écrit depuis son espace.",
    accent: "#0369A1",
    recipientAlias: "teacherName",
    senderAlias: "studentName",
    variables: variables(V.teacherName, V.studentName, V.className),
    defaults: {
      subject: "Message d'un étudiant : {{subject}}",
      body: `<p>Bonjour {{teacherName}},</p>

<p><strong>{{studentName}}</strong> vous a adressé un message depuis son espace étudiant.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Mme Clarisse Assi",
      senderName: "Aminata Diallo",
      className: "L2 Gestion A",
      subject: "Question sur le TD de jeudi",
      message:
        "Bonjour Madame, je n'ai pas réussi à ouvrir le support du TD de jeudi. Pourriez-vous le redéposer sur l'espace de cours ?",
    },
  },
  {
    kind: "student_teacher_reply",
    profile: "student",
    label: "Réponse d'un étudiant à un enseignant",
    description: "Envoyé à l'enseignant quand un étudiant répond à l'un de ses messages.",
    accent: "#0E7490",
    recipientAlias: "teacherName",
    senderAlias: "studentName",
    variables: variables(V.teacherName, V.studentName, V.conversationSubject),
    defaults: {
      subject: "Re : {{conversationSubject}} — {{studentName}}",
      body: `<p>Bonjour {{teacherName}},</p>

<p><strong>{{studentName}}</strong> a répondu à votre message
« {{conversationSubject}} ».</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

${SIGNATURE_BLOCK}`,
    },
    sample: {
      recipientName: "Mme Clarisse Assi",
      senderName: "Aminata Diallo",
      conversationSubject: "Documents du prochain TD",
      subject: "Documents du prochain TD",
      message: "Merci Madame, j'ai bien récupéré les documents.",
    },
  },
  {
    kind: "student_school",
    profile: "student",
    label: "Message d'un étudiant à l'établissement",
    description: "Envoyé aux administrateurs quand un étudiant écrit à l'établissement.",
    accent: "#B45309",
    recipientAlias: "adminName",
    senderAlias: "studentName",
    variables: variables(V.adminName, V.studentName),
    defaults: {
      subject: "[Étudiant → Établissement] {{subject}} — {{studentName}}",
      body: `<p>Bonjour {{adminName}},</p>

<p><strong>{{studentName}}</strong> adresse le message suivant à l'administration de
l'établissement.</p>

${MESSAGE_BLOCK}

${CTA_BLOCK}

<p class="signature">Message transmis automatiquement depuis l'espace étudiant.</p>`,
    },
    sample: {
      recipientName: "Service scolarité",
      senderName: "Aminata Diallo",
      subject: "Duplicata de carte d'étudiant",
      message:
        "Bonjour, j'ai égaré ma carte d'étudiant et souhaiterais connaître la démarche pour obtenir un duplicata.",
    },
  },
];

/* --------------------------------------------------------------------------
 * Registre
 * ------------------------------------------------------------------------ */

const ALL_DEFINITIONS: MessageTemplateDefinition[] = [
  ...ADMIN_DEFINITIONS,
  ...TEACHER_DEFINITIONS,
  ...PARENT_DEFINITIONS,
  ...STUDENT_DEFINITIONS,
];

export const MESSAGE_TEMPLATE_DEFINITIONS = Object.fromEntries(
  ALL_DEFINITIONS.map((definition) => [definition.kind, definition])
) as Record<MessageTemplateKind, MessageTemplateDefinition>;

/** Ordre d'affichage : profil par profil, dans l'ordre de déclaration. */
export const MESSAGE_TEMPLATE_KINDS: MessageTemplateKind[] = ALL_DEFINITIONS.map((d) => d.kind);

export function isMessageTemplateKind(value: unknown): value is MessageTemplateKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGE_TEMPLATE_DEFINITIONS, value);
}

export function messageTemplateKindsForProfile(profile: MessageTemplateProfile): MessageTemplateKind[] {
  return ALL_DEFINITIONS.filter((d) => d.profile === profile).map((d) => d.kind);
}
