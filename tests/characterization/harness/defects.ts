/**
 * Catalogue des BOGUES CONNUS du legacy, découverts pendant la caractérisation.
 *
 * Chaque snapshot référence ce catalogue par `id` dans son champ `knownLegacyDefects` et indique le chemin
 * exact (dans `data`) de chaque valeur concernée, avec la valeur legacy et la valeur correcte. Les tests v2
 * (Phase 2) DOIVENT diverger à ces chemins - et seulement là : voir `compare.ts`.
 *
 * Statuts :
 *   - `bug`      : le legacy produit une valeur fausse au regard de sa propre règle documentée ;
 *   - `quirk`    : comportement surprenant mais cohérent avec la règle écrite (la v2 peut le conserver ou le changer, décision métier) ;
 *   - `dead`     : code mort ou règle documentée mais jamais appliquée.
 */
export type DefectStatus = "bug" | "quirk" | "dead";

export interface DefectCatalogEntry {
  id: string;
  status: DefectStatus;
  title: string;
  description: string;
  /** Exemple chiffré (reproductible dans les snapshots). */
  example: string;
  /** Source legacy (fichier:fonction). */
  where: string;
  /** ADR / document qui en parle, le cas échéant. */
  ref?: string;
}

export const DEFECT_CATALOG: Record<string, DefectCatalogEntry> = {
  FLOAT_ECUE_VALIDATION_10: {
    id: "FLOAT_ECUE_VALIDATION_10",
    status: "bug",
    title: "Seuil de validation d'ECUE (10) testé sur un flottant binaire",
    description:
      "La note d'ECUE devoirs×0,4 + examen×0,6 est calculée en double. Sur la grille 0,00-20,00 au centième, 24 couples " +
      "(devoirs, examen) donnent une note exactement égale à 10 que le code juge < 10 : l'ECUE n'est ni validée ni compensée, " +
      "l'UE passe en échec ou en rattrapage alors que l'étudiant a exactement la moyenne.",
    example: "devoirs 0,40 / examen 16,40 : 0.4*0.4 + 16.4*0.6 = 9.999999999999998 (< 10) alors que la note vaut exactement 10.",
    where: "apps/api/src/services/bulletin-calc.ts:evaluerEcue (note >= SEUIL_VALIDATION) ; professional-results.service.ts:recomputeEcueResult",
    ref: "docs/adr/ADR-003-dsl-regles-academiques.md",
  },
  FLOAT_ECUE_ELIMINATOIRE_5: {
    id: "FLOAT_ECUE_ELIMINATOIRE_5",
    status: "bug",
    title: "Seuil éliminatoire (< 5) testé sur un flottant binaire",
    description:
      "8 couples (devoirs, examen) de la grille donnent une note exactement égale à 5 que le code juge < 5 : l'ECUE est déclarée " +
      "éliminatoire à tort et verrouille toute l'UE, sans compensation possible.",
    example: "devoirs 0,20 / examen 8,20 : 0.2*0.4 + 8.2*0.6 = 4.999999999999999 (< 5) alors que la note vaut exactement 5.",
    where: "apps/api/src/services/bulletin-calc.ts:evaluerEcue (note < SEUIL_ELIMINATOIRE)",
    ref: "docs/adr/ADR-003-dsl-regles-academiques.md",
  },
  FLOAT_UE_VALIDATION_10: {
    id: "FLOAT_UE_VALIDATION_10",
    status: "bug",
    title: "Seuil de validation d'UE (10) testé sur une moyenne pondérée flottante",
    description:
      "La moyenne d'UE Σ(note×crédits)/Σcrédits est calculée en double : une moyenne exactement égale à 10 peut sortir à 9,999999999999998 " +
      "et l'UE n'est pas validée.",
    example: "ECUE 6,40 (1 crédit) et 11,20 (3 crédits) : (6.4*1 + 11.2*3)/4 = 9.999999999999998 au lieu de 10.",
    where: "apps/api/src/services/bulletin-calc.ts:moyenneUe / evaluerUe (moyenne >= SEUIL_VALIDATION)",
  },
  ROUNDED_INPUTS_ECUE_RECOMPUTE: {
    id: "ROUNDED_INPUTS_ECUE_RECOMPUTE",
    status: "bug",
    title: "Moyenne des devoirs et note d'examen arrondies à 2 décimales avant le calcul définitif",
    description:
      "professional_ecue_results stocke moyenne_devoirs, note_examen et moyenne en numeric(6,2). Le bulletin et la validation d'UE " +
      "recalculent la note d'ECUE à partir de ces valeurs ARRONDIES, alors que la validation de l'ECUE (champ validee) a été décidée " +
      "sur les valeurs exactes : deux réponses différentes pour la même ECUE (cf. DIVERGENT_ECUE_VALIDITY).",
    example: "devoirs 9,99 et 10,00 (moyenne 9,995 -> stockée 10,00), examen 10,00 : validee = false (9,998) mais le bulletin recalcule 10 et valide l'ECUE.",
    where: "professional-results.service.ts:recomputeEcueResult (INSERT) + evaluateUeValidation / professional-bulletin.service.ts:computeStudentBulletin (relecture)",
  },
  DIVERGENT_ECUE_VALIDITY: {
    id: "DIVERGENT_ECUE_VALIDITY",
    status: "bug",
    title: "professional_ecue_results.validee et bulletin.validee peuvent se contredire",
    description:
      "Le champ validee (qui alimente la liste des rattrapages) est calculé sur la note exacte ; le bulletin et student_professional_ue_results " +
      "sont calculés sur les valeurs arrondies relues en base. Un étudiant peut apparaître en rattrapage alors que son bulletin valide l'ECUE.",
    example: "devoirs 9,99 / 10,00, examen 10,00 : résultat ECUE non validé (listé en rattrapage), bulletin : ECUE validée.",
    where: "professional-results.service.ts (validee) vs professional-bulletin.service.ts (evaluerUe sur valeurs relues)",
  },
  DISPLAY_ROUNDING_NOT_HALF_UP: {
    id: "DISPLAY_ROUNDING_NOT_HALF_UP",
    status: "bug",
    title: "arrondi d'affichage = Math.round(x*100)/100, pas un demi-supérieur décimal",
    description:
      "Math.round(x*100)/100 dépend de l'erreur binaire de x*100 : 1,005 s'affiche 1 (et non 1,01), 1,255 s'affiche 1,25 (et non 1,26), 9,995 s'affiche 9,99 (et non 10,00). " +
      "Le même nombre stocké par PostgreSQL (numeric) serait arrondi demi-supérieur : 1,01 / 1,26 / 10,00.",
    example: "arrondi(1.005) = 1 ; arrondi(1.255) = 1.25 ; arrondi(9.995) = 9.99 (affichage) alors que numeric(6,2) enregistre 1.01 / 1.26 / 10.00.",
    where: "apps/api/src/services/bulletin-calc.ts:arrondi",
  },
  DISPLAYED_AVERAGE_10_NOT_VALIDATED: {
    id: "DISPLAYED_AVERAGE_10_NOT_VALIDATED",
    status: "quirk",
    title: "Une moyenne affichée 10 peut ne pas valider l'UE (validation sur la valeur NON arrondie, affichage arrondi)",
    description:
      "Voulu (ADR-003 : « 9,995 ne vaut pas 10 ») mais déroutant : la moyenne d'UE s'affiche à 2 décimales (arrondi) alors que le seuil de validation porte sur la valeur " +
      "exacte. Un étudiant à 9,996 voit « 10 » sur son bulletin avec une UE « en dette ». La v2 doit conserver la règle ; l'affichage reste à arbitrer.",
    example: "Anglais technique de rita : devoirs 9,99 et examen 10 -> note 9,996 affichée 10, UE503 non validée (dette).",
    where: "apps/api/src/services/bulletin-calc.ts:evaluerUe (moyenne >= SEUIL_VALIDATION) vs arrondi()",
  },
  CLASSIC_FLOAT_WEIGHTED_MEAN: {
    id: "CLASSIC_FLOAT_WEIGHTED_MEAN",
    status: "bug",
    title: "Moyenne pondérée classique en flottant : mention, décision et passage sur un seuil exact",
    description:
      "La pile classique calcule Σ(moyenne×coef)/Σcoef en double. Une moyenne exactement égale à un seuil (8/10/12/14/16) peut sortir juste dessous : " +
      "mention inférieure, 'Renforcement recommande' au lieu de 'Periode validee', redoublement au lieu d'admission.",
    example: "matières 6,40 (coef 1) et 11,20 (coef 3) : moyenne 9.999999999999998 -> 'Passable' / 'Renforcement recommande' au lieu de 'Assez bien' / 'Periode validee'.",
    where: "apps/api/src/routes/semester-averages.ts:computeWeightedStats / buildAverageMention / buildCouncilDecision",
  },
  CLASSIC_SEMESTER_DETECTED_BY_NAME: {
    id: "CLASSIC_SEMESTER_DETECTED_BY_NAME",
    status: "quirk",
    title: "Le deuxième semestre et le BTS 2 sont détectés par le NOM de la période et de la classe",
    description:
      "isSecondSemester = nom de période contenant « SEMESTRE 2 » / « DEUXIEME SEMESTRE » (accents ignorés) ; isSecondYearBts = nom de classe " +
      "contenant « BTS » et « 2 » ou « DEUXIEME ». Renommer une période change la formule annuelle, sans erreur.",
    example:
      "Période « S2 » : isSecondSemester = false, la moyenne annuelle vaut la moyenne du semestre (S2 = 16, S1 = 14 : 16 au lieu de 15,33). " +
      "Période « Deuxième semestre » sans période « Semestre 1 » : le premier semestre devient la période PRÉCÉDENTE (« S2 »). Classe « BTS2 Info » : non reconnue comme BTS 2.",
    where: "apps/api/src/routes/semester-averages.ts (POST /report-cards/pdf)",
  },
  CLASSIC_REPEATING_FROM_DECISION_TEXT: {
    id: "CLASSIC_REPEATING_FROM_DECISION_TEXT",
    status: "quirk",
    title: "Redoublant déduit en cherchant « REDOUBL » dans le texte de la décision",
    description:
      "buildAssignmentFlagsFromDecision normalise le texte de la décision (sans accents, majuscules) : repeating = contient « REDOUBL », " +
      "affected = ni redoublant ni « ATTENTE ». La décision BTS 2 « Redouble en cas d'échec au BTS » rend donc repeating = true même si l'élève a 15 de moyenne.",
    example: "BTS 2, 2e semestre, moyenne annuelle 15 : endYearDecision = « Redouble en cas d'échec au BTS » -> repeating = true.",
    where: "apps/api/src/routes/semester-averages.ts:buildAssignmentFlagsFromDecision",
  },
  RULES_NOT_WIRED_SEMESTER_20_CREDITS: {
    id: "RULES_NOT_WIRED_SEMESTER_20_CREDITS",
    status: "dead",
    title: "La règle « semestre validé à 20 crédits » n'est pas celle que le bulletin applique",
    description:
      "bulletin-calc exporte semestreValide(credits >= 20) mais computeStudentBulletin valide le semestre quand TOUTES les UE sont validées (aucune compensation entre UE). " +
      "Les deux règles divergent dans les deux sens : un étudiant qui acquiert 28 crédits sur un semestre de 36 est « validé » selon la fonction pure, " +
      "« rattrapage/ajourné » selon le bulletin ; un semestre de 6 crédits entièrement validé est « admis » selon le bulletin, non validé selon la fonction pure.",
    example:
      "Semestre de 36 crédits, 28 crédits acquis : semestreValide(28) = true ; bulletin.semestre_valide = false, decision = 'rattrapage'. " +
      "Semestre de 6 crédits tous acquis : semestreValide(6) = false ; bulletin.semestre_valide = true, decision = 'admis'.",
    where: "apps/api/src/services/bulletin-calc.ts:semestreValide (jamais appelée) vs professional-bulletin.service.ts (ues.every(validee))",
  },
  RULES_NOT_WIRED_YEAR_48_CREDITS: {
    id: "RULES_NOT_WIRED_YEAR_48_CREDITS",
    status: "dead",
    title: "La règle « passage en année supérieure : plus de 48 crédits » n'est appelée nulle part",
    description:
      "peutPasserAnneeSuperieure(credits > 48) n'est référencée par aucun service ni aucune route : aucune décision de passage annuel n'est calculée " +
      "par le legacy pour la pile Professional (le bilan annuel du bulletin BTS ne porte qu'une moyenne et un rang).",
    example: "Année de 56 crédits, 48 acquis : peutPasserAnneeSuperieure(48) = false ; aucune décision annuelle n'existe dans les bulletins.",
    where: "apps/api/src/services/bulletin-calc.ts:peutPasserAnneeSuperieure",
  },
  SESSION2_REPLACES_EVEN_IF_LOWER: {
    id: "SESSION2_REPLACES_EVEN_IF_LOWER",
    status: "quirk",
    title: "La note d'examen de session 2 remplace celle de session 1 même si elle est plus basse",
    description:
      "computeEcueBreakdown retient l'examen manuel de session la plus élevée (ORDER BY session DESC LIMIT 1), sans comparer les valeurs : un étudiant déjà " +
      "validé en session 1 peut perdre sa validation s'il passe quand même le rattrapage et y obtient moins.",
    example: "Examen S1 = 14 (validé), examen S2 = 4 : l'examen retenu est 4, ECUE éliminatoire.",
    where: "apps/api/src/services/professional-results.service.ts:computeEcueBreakdown",
  },
  PAYMENT_STATUS_ENDPOINT_NO_STATE_MACHINE: {
    id: "PAYMENT_STATUS_ENDPOINT_NO_STATE_MACHINE",
    status: "bug",
    title: "PATCH /teacher-payments/:id/status accepte toute transition et un utilisateur codé en dur",
    description:
      "Contrairement à /approve et /bulk-action (qui exigent calculated -> approved -> paid), la route PATCH /:id/status applique n'importe quel statut " +
      "(cancelled -> paid, calculated -> paid) et enregistre approved_by = UUID codé en dur « 634a57fe-... ».",
    example: "Un bulletin 'cancelled' peut repasser 'paid' ; un bulletin 'calculated' peut passer 'paid' sans approbation.",
    where: "apps/api/src/routes/teacher-payments.ts (PATCH /:id/status)",
  },
  PAYSLIP_LINES_ROUNDING: {
    id: "PAYSLIP_LINES_ROUNDING",
    status: "bug",
    title: "Une ligne de bulletin n'égale pas « heures × tarif enregistré » (tarif majoré arrondi à part du montant)",
    description:
      "Le tarif d'une ligne d'heures supplémentaires (tarif × multiplicateur) est enregistré en numeric(8,2) tandis que le montant de la ligne est calculé sur le " +
      "flottant non arrondi puis enregistré en numeric(10,2) : heures × tarif lu sur la ligne ≠ montant de la ligne, et le contrôle ligne à ligne d'un bulletin " +
      "échoue d'un ou plusieurs centimes.",
    example: "Tarif 3 333,33 × 1,5 = 4 999,995 enregistré 5 000,00 ; ligne de 4 h : 4 × 5 000,00 = 20 000,00 mais montant enregistré 19 999,98.",
    where: "apps/api/src/routes/teacher-payments.ts (INSERT teacher_payments / payment_hour_details) ; payment-calculator.ts:calculateHourlyPayment",
  },
  PAYMENT_ARCHIVE_REVIVES_CANCELLED: {
    id: "PAYMENT_ARCHIVE_REVIVES_CANCELLED",
    status: "bug",
    title: "L'archivage « tout arrêter » remet au statut approuvé un bulletin annulé",
    description:
      "POST /bulletins/archiver {tous:true} met à jour tous les bulletins du tenant dont archived_at est NULL, sans filtrer sur le statut : un bulletin " +
      "'cancelled' (ou 'disputed') redevient 'approved' (donc versable), et ses heures, relâchées par l'annulation, sont de nouveau considérées comme payées.",
    example: "Bulletin annulé puis « Tout archiver » : status = approved, approved_at renseigné, archived_at renseigné.",
    where: "apps/api/src/services/teacher-payroll-overview.service.ts:archiverBulletins",
  },
  PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE: {
    id: "PAYSLIP_OVERTIME_SPLIT_VIOLATES_UNIQUE",
    status: "bug",
    title: "Une séance à cheval sur le seuil d'heures supplémentaires fait échouer tout le bulletin",
    description:
      "Le calcul coupe la séance qui franchit le seuil hebdomadaire en deux lignes (heures normales + heures supplémentaires) portant le MÊME identifiant de séance ; " +
      "les index uniques uniq_phd_payment_seance et uniq_phd_payment_attendance (payment_id, seance_id | attendance_session_id) refusent la seconde ligne. " +
      "L'INSERT échoue, la transaction du bulletin est annulée et l'enseignant n'a aucun bulletin (compté dans `errors`), alors que l'aperçu (dryRun) affiche un montant.",
    example: "Vacataire à seuil 10 h/semaine avec 12 h dans la semaine, dont une séance de 4 h qui franchit le seuil : aperçu 43 333,29 ; calcul réel : « duplicate key value violates unique constraint uniq_phd_payment_seance ».",
    where: "apps/api/src/routes/teacher-payments.ts (POST /calculate, INSERT payment_hour_details) ; payment-calculator.ts:calculateHourlyPayment (toDetailLine x2) ; migration 0103 (index uniques)",
  },
  PAYMENT_OVERLAPPING_PERIOD_DOUBLES_SALARY: {
    id: "PAYMENT_OVERLAPPING_PERIOD_DOUBLES_SALARY",
    status: "bug",
    title: "Deux périodes de paie qui se chevauchent produisent deux salaires pour le même mois",
    description:
      "Depuis la migration 0112 le chevauchement de périodes est autorisé. Les heures sont protégées (heures consommées) mais pas le salaire : chaque période calcule " +
      "le salaire mensuel au prorata de ses propres jours ouvrés, sans tenir compte des bulletins salariaux déjà émis pour les mêmes dates.",
    example: "Deux périodes du 05/01 au 31/01 : le permanent reçoit deux bulletins de 363 636,36.",
    where: "apps/api/src/services/payment-calculator.ts:calculateSalaryPayment ; routes/payment-periods.ts (chevauchement journalisé, non refusé)",
  },
  PAYMENT_RECALCULATE_ERASES_ADJUSTMENTS: {
    id: "PAYMENT_RECALCULATE_ERASES_ADJUSTMENTS",
    status: "quirk",
    title: "Recalculer un bulletin au statut « calculé » efface la prime et la retenue saisies",
    description:
      "Le recalcul réécrit bonus_amount = 0 et deductions = 0 (calculés par le moteur, qui ne connaît pas les ajustements manuels). Un ajustement " +
      "PATCH /:id/adjustments n'est donc conservé que jusqu'au prochain recalcul ; les bulletins approuvés, payés ou annulés ne sont, eux, jamais recalculés.",
    example: "Prime 5 000 et retenue 2 000 sur le bulletin d'Awa, puis « recalculate: true » : prime = 0, retenue = 0, total = base + heures sup.",
    where: "apps/api/src/routes/teacher-payments.ts (POST /calculate, branche UPDATE)",
  },
};

export type DefectId = keyof typeof DEFECT_CATALOG;

/** Occurrence d'un défaut dans UNE snapshot. */
export interface DefectOccurrence {
  id: string;
  /** Chemin pointé dans `data` (ex. `bulletins.fatou.ues.UE101.ecues.101A.validee`). */
  path: string;
  legacy: unknown;
  /** Valeur correcte selon la règle documentée (oracle exact). */
  correct: unknown;
  /**
   * Sous-arbres où la v2 est AUTORISÉE à diverger à cause de ce défaut (conséquences en cascade : crédits, décision,
   * rang des autres étudiants...). Motifs : segments séparés par `.`, `[n]` = indice de tableau (segment à part),
   * `*` = un segment, `**` = tout le reste. Le chemin du défaut lui-même est toujours couvert.
   */
  scope: string[];
  /** `false` quand `correct` est un texte libre (« à arbitrer... », « transition refusée »...) qu'une machine ne peut pas comparer. */
  comparable?: false;
  note?: string;
}

/** Collecteur utilisé pendant l'observation. */
export class DefectCollector {
  readonly occurrences: DefectOccurrence[] = [];

  flag(
    id: DefectId | string,
    path: string,
    legacy: unknown,
    correct: unknown,
    options: { note?: string; scope?: string[] } = {},
  ): void {
    if (!DEFECT_CATALOG[id]) throw new Error(`Défaut inconnu du catalogue : ${id}`);
    const free = typeof correct === "string" && /^(à arbitrer|règle voulue|transition refusée)|\|/.test(correct);
    this.occurrences.push({
      id,
      path,
      legacy,
      correct,
      scope: options.scope ?? [],
      ...(free ? { comparable: false as const } : {}),
      ...(options.note ? { note: options.note } : {}),
    });
  }

  sorted(): DefectOccurrence[] {
    return [...this.occurrences].sort((a, b) => (a.path + a.id < b.path + b.id ? -1 : a.path + a.id > b.path + b.id ? 1 : 0));
  }
}
