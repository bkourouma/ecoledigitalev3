import type {
  OwnerAssiduiteResponse,
  OwnerFinancesProResponse,
  OwnerPedagogieResponse,
  OwnerPersonnesResponse,
  OwnerRecrutementResponse,
} from "@ecoledigitale/contracts";

/**
 * Construction des exports CSV des pages de statistiques owner.
 *
 * Deux contraintes propres à Excel en configuration française, reprises de
 * `buildOwnerFinancialReportCsv` :
 *  - le fichier est préfixé d'un BOM UTF-8 (posé par la route), sans quoi les
 *    accents sont illisibles ;
 *  - le séparateur est le point-virgule, la virgule étant le séparateur décimal.
 *
 * Chaque export est MULTI-SECTIONS : un seul fichier porte tous les blocs de la
 * page, séparés par une ligne vide et un titre. C'est ce qui permet à un
 * propriétaire de retrouver dans le tableur exactement ce qu'il voit à l'écran.
 */

/** Séparateur attendu par Excel FR. */
const SEP = ";";

/**
 * Échappe une valeur pour le CSV.
 *
 * Le guillemet doublé et l'encadrement sont obligatoires dès que la valeur
 * contient le séparateur, un guillemet ou un saut de ligne — un libellé d'ECUE
 * contenant un point-virgule décalerait sinon toutes les colonnes suivantes.
 */
function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Nombre au format français : virgule décimale, pas de séparateur de milliers. */
function num(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return v.toFixed(decimals).replace(".", ",");
}

function row(cells: unknown[]): string {
  return cells.map(esc).join(SEP);
}

/** Une section = un titre, un en-tête de colonnes, des lignes. */
function section(title: string, headers: string[], rows: unknown[][]): string[] {
  const out = [row([title]), row(headers)];
  if (rows.length === 0) {
    out.push(row(["(aucune donnée)"]));
  } else {
    for (const r of rows) out.push(row(r));
  }
  out.push("");
  return out;
}

export function buildOwnerPedagogieCsv(d: OwnerPedagogieResponse): string {
  const lines: string[] = [];

  lines.push(row(["Pilotage pédagogique LMD"]));
  lines.push(row(["Année scolaire", d.anneeScolaire ?? "Toutes"]));
  lines.push(row(["Semestre", d.semestreId ?? "Tous"]));
  lines.push(row(["Statut des sessions", d.statut]));
  lines.push(row(["Catégorie d'UE", d.categorie ?? "Toutes"]));
  lines.push("");

  lines.push(
    ...section(
      "Indicateurs",
      ["Indicateur", "Valeur", "Règle de calcul"],
      [
        ["Bulletins", d.kpis.bulletinCount, "Bulletins du périmètre"],
        [
          "Taux de réussite (%)",
          num(d.kpis.successRate, 1),
          "Décision « admis » / total des bulletins",
        ],
        [
          "Moyenne générale /20",
          num(d.kpis.averageGrade),
          "Moyenne des moyennes de session",
        ],
        [
          "Crédits validés (%)",
          num(d.kpis.creditsRate, 1),
          `${d.kpis.creditsValidated} / ${d.kpis.creditsTotal}`,
        ],
        [
          "Taux de rattrapage (%)",
          num(d.kpis.retakeRate, 1),
          "Décision « rattrapage » / total",
        ],
        [
          "Bulletins définitifs (%)",
          num(d.kpis.finalBulletinRate, 1),
          "Statut « définitif » / total",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Décisions par filière",
      ["Filière", "Admis", "Rattrapage", "Ajourné", "Total"],
      d.decisionsByFiliere.map((r) => [
        r.filiereName,
        r.admis,
        r.rattrapage,
        r.ajourne,
        r.total,
      ])
    )
  );

  lines.push(
    ...section(
      "Moyennes par semestre",
      ["Filière", "Semestre", "Moyenne /20", "Étudiants"],
      d.averagesBySemestre.map((r) => [
        r.filiereName,
        r.semestreLabel,
        num(r.averageGrade),
        r.studentCount,
      ])
    )
  );

  lines.push(
    ...section(
      "ECUE les plus échouées (Conduite exclue)",
      ["Code", "Libellé", "Résultats notés", "Échecs", "Dont éliminatoires", "Taux d'échec (%)"],
      d.topFailedEcue.map((r) => [
        r.code,
        r.libelle,
        r.evaluated,
        r.failed,
        r.eliminated,
        num(r.failRate, 1),
      ])
    )
  );

  lines.push(
    ...section(
      "Santé par UE",
      [
        "Code",
        "Libellé",
        "Filière",
        "Catégorie",
        "Étudiants",
        "Moyenne /20",
        "Validation (%)",
        "Éliminatoires (%)",
        "Session 2 (%)",
      ],
      d.ueHealth.map((r) => [
        r.code,
        r.libelle,
        r.filiereName,
        r.categorie ?? "",
        r.studentCount,
        num(r.averageGrade),
        num(r.validationRate, 1),
        num(r.eliminatedRate, 1),
        num(r.session2Rate, 1),
      ])
    )
  );

  lines.push(
    ...section(
      "Distribution des moyennes",
      ["Tranche", "Étudiants"],
      d.gradeDistribution.map((r) => [r.bucket, r.count])
    )
  );

  return lines.join("\r\n");
}

export function buildOwnerFinancesProCsv(d: OwnerFinancesProResponse): string {
  const lines: string[] = [];

  lines.push(row(["Recouvrement — Module professionnel"]));
  lines.push(row(["Période", `${d.periodStart} → ${d.periodEnd}`]));
  lines.push(
    row([
      "UE « Conduite »",
      "Incluses (écart assumé avec l'écran admin des paiements)",
    ])
  );
  lines.push("");

  lines.push(
    ...section(
      "Totaux",
      ["Indicateur", "Valeur (FCFA)", "Règle de calcul"],
      [
        [
          "Chiffre d'affaires attendu",
          d.totals.expected,
          "Somme des commandes non annulées de la période",
        ],
        [
          "Encaissé",
          d.totals.collected,
          "Somme des paiements confirmés sur ces commandes",
        ],
        ["Taux de recouvrement (%)", num(d.totals.recoveryRate, 1), "Encaissé / attendu"],
        ["Reste à recouvrer", d.totals.outstanding, "Attendu − encaissé, borné à zéro"],
        [
          "Étudiants non soldés",
          d.totals.unsettledStudents,
          "Reste dû supérieur à 0,5 FCFA",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Encaissements mensuels (12 mois glissants)",
      ["Mois", "Montant (FCFA)", "Transactions"],
      d.monthlyCollections.map((r) => [r.month, r.amount, r.transactionCount])
    )
  );

  lines.push(
    ...section(
      "Répartition par mode de règlement",
      ["Mode", "Montant (FCFA)", "Transactions"],
      d.byPaymentMode.map((r) => [r.mode, r.amount, r.count])
    )
  );

  lines.push(
    ...section(
      "Recouvrement par filière",
      ["Filière", "Attendu (FCFA)", "Encaissé (FCFA)", "Taux (%)"],
      d.recoveryByFiliere.map((r) => [
        r.filiereName,
        r.expected,
        r.collected,
        num(r.recoveryRate, 1),
      ])
    )
  );

  lines.push(
    ...section(
      "Impayés",
      [
        "Étudiant",
        "Matricule",
        "Filières",
        "Dû (FCFA)",
        "Payé (FCFA)",
        "Reste (FCFA)",
        "Plus ancienne commande non soldée",
      ],
      d.topUnpaid.map((r) => [
        r.studentName,
        r.matricule ?? "",
        r.filiereNames ?? "",
        r.due,
        r.paid,
        r.outstanding,
        r.oldestUnpaidAt ?? "",
      ])
    )
  );

  lines.push(
    ...section(
      "Chiffre d'affaires par UE",
      ["Code", "Libellé", "Filière", "Inscriptions confirmées", "CA (FCFA)"],
      d.revenueByUe.map((r) => [
        r.code,
        r.libelle,
        r.filiereName,
        r.confirmedEnrollments,
        r.revenue,
      ])
    )
  );

  lines.push(
    ...section(
      "Entonnoir des inscriptions",
      ["Étape", "Nombre"],
      [
        ["Créées", d.enrollmentFunnel.created],
        ["Confirmées", d.enrollmentFunnel.confirmed],
        ["Terminées", d.enrollmentFunnel.completed],
        ["Annulées", d.enrollmentFunnel.cancelled],
      ]
    )
  );

  return lines.join("\r\n");
}

export function buildOwnerAssiduiteCsv(d: OwnerAssiduiteResponse): string {
  const lines: string[] = [];

  lines.push(row(["Assiduité, salles et charge enseignante"]));
  lines.push(row(["Période", `${d.dateDebut} → ${d.dateFin}`]));
  lines.push(
    row([
      "Base du taux d'occupation",
      `${d.openingHoursPerWeek} heures ouvrables par semaine et par salle`,
    ])
  );
  lines.push("");

  lines.push(
    ...section(
      "Indicateurs",
      ["Indicateur", "Valeur", "Règle de calcul"],
      [
        [
          "Taux de présence (%)",
          num(d.kpis.presenceRate, 1),
          "Présents et retards / total des pointages",
        ],
        [
          "Heures d'absence",
          num(d.kpis.absenceHours, 1),
          "Cumul des durées de séance, absences non excusées",
        ],
        [
          "Appels effectués (%)",
          num(d.kpis.callRate, 1),
          "Séances passées avec au moins un pointage",
        ],
        [
          "Occupation des salles (%)",
          num(d.kpis.roomOccupancyRate, 1),
          "Heures planifiées / (heures ouvrables × salles actives)",
        ],
        [
          "Heures planifiées",
          num(d.kpis.plannedHours, 1),
          "Emploi du temps hebdomadaire",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Assiduité par semaine et par filière",
      ["Semaine", "Filière", "Présence (%)", "Pointages"],
      d.attendanceByWeek.map((r) => [
        r.weekStart,
        r.filiereName,
        num(r.presentRate, 1),
        r.totalRecords,
      ])
    )
  );

  lines.push(
    ...section(
      "Étudiants les plus absents",
      ["Étudiant", "Matricule", "Heures d'absence", "Heures excusées", "Absences"],
      d.topAbsentStudents.map((r) => [
        r.studentName,
        r.matricule ?? "",
        num(r.absenceHours, 1),
        num(r.excusedHours, 1),
        r.absenceCount,
      ])
    )
  );

  lines.push(
    ...section(
      "Charge par enseignant",
      ["Enseignant", "Heures / semaine", "ECUE", "Filières", "Compte utilisateur"],
      d.teacherLoad.map((r) => [
        r.teacherName,
        num(r.weeklyHours, 1),
        r.ecueCount,
        r.filiereCount,
        r.hasUserAccount ? "Oui" : "Aucun",
      ])
    )
  );

  lines.push(
    ...section(
      "Usage des salles",
      ["Salle", "Code", "Bâtiment", "Capacité", "Heures / semaine", "Taux (%)"],
      d.roomUsage.map((r) => [
        r.name,
        r.code,
        r.building ?? "",
        r.capacity,
        num(r.weeklyHours, 1),
        num(r.occupancyRate, 1),
      ])
    )
  );

  lines.push(
    ...section(
      "ECUE obligatoires sans enseignant",
      ["Filière", "UE", "Code ECUE", "Libellé ECUE"],
      d.unassignedEcue.map((r) => [r.filiereName, r.ueCode, r.ecueCode, r.ecueLibelle])
    )
  );

  return lines.join("\r\n");
}

export function buildOwnerPersonnesCsv(d: OwnerPersonnesResponse): string {
  const lines: string[] = [];

  lines.push(row(["Personnes — démographie et comptes"]));
  lines.push("");

  lines.push(
    ...section(
      "Indicateurs",
      ["Indicateur", "Valeur", "Précision"],
      [
        ["Étudiants actifs", d.kpis.activeStudents, ""],
        ["Enseignants actifs", d.kpis.activeTeachers, ""],
        ["Parents", d.kpis.parents, "Comptes utilisateurs portant le rôle parent"],
        [
          "Ratio étudiants / enseignant",
          num(d.kpis.studentTeacherRatio, 1),
          "",
        ],
        [
          "Comptes sans identifiants",
          d.kpis.accountsWithoutCredentials,
          "Mot de passe initial non généré — l'envoi n'est pas tracé en base",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Répartition par sexe",
      ["Sexe", "Étudiants"],
      d.genderDistribution.map((r) => [r.gender ?? "Non renseigné", r.count])
    )
  );

  lines.push(
    ...section(
      "Pyramide des âges",
      ["Tranche", "Étudiants"],
      d.agePyramid.map((r) => [`${r.bucketStart}-${r.bucketStart + 1} ans`, r.count])
    )
  );

  lines.push(
    ...section(
      "Effectifs par filière",
      ["Filière", "Cycle", "Étudiants"],
      d.headcountByFiliere.map((r) => [r.filiereName, r.cycleName ?? "", r.count])
    )
  );

  lines.push(
    ...section(
      "Enseignants",
      [
        "Enseignant",
        "Contrat",
        "Statut",
        "Embauche",
        "Ancienneté (années)",
        "ECUE",
        "Filières",
        "Compte utilisateur",
      ],
      d.teachers.map((r) => [
        r.teacherName,
        r.contractType,
        r.status,
        r.hireDate ?? "",
        r.seniorityYears ?? "",
        r.ecueCount,
        r.filiereCount,
        r.hasUserAccount ? "Oui" : "Aucun",
      ])
    )
  );

  lines.push(
    ...section(
      "Nationalités",
      ["Nationalité", "Étudiants"],
      d.topNationalities.map((r) => [r.nationality, r.count])
    )
  );

  lines.push(
    ...section(
      "Couverture des données",
      ["Indicateur", "Nombre"],
      [
        ["Étudiants sans parent rattaché", d.coverage.studentsWithoutParent],
        ["Parents sans enfant", d.coverage.parentsWithoutChild],
        ["Enseignants sans compte", d.coverage.teachersWithoutAccount],
        ["Étudiants sans date de naissance", d.coverage.studentsWithoutBirthDate],
      ]
    )
  );

  return lines.join("\r\n");
}

export function buildOwnerRecrutementCsv(d: OwnerRecrutementResponse): string {
  const lines: string[] = [];

  lines.push(row(["Recrutement en ligne"]));
  lines.push(row(["Période", `${d.dateDebut} → ${d.dateFin}`]));
  lines.push("");

  lines.push(
    ...section(
      "Indicateurs",
      ["Indicateur", "Valeur", "Règle de calcul"],
      [
        ["Demandes reçues", d.kpis.received, ""],
        [
          "Taux de validation (%)",
          num(d.kpis.approvalRate, 1),
          "Validées / (validées + rejetées) — les demandes en attente sont exclues",
        ],
        [
          "Délai moyen de traitement (jours)",
          num(d.kpis.avgProcessingDays, 1),
          "Écart entre le dépôt et la revue",
        ],
        ["En attente", d.kpis.pending, ""],
      ]
    )
  );

  lines.push(
    ...section(
      "Entonnoir",
      ["Étape", "Nombre"],
      [
        ["Demandes reçues", d.funnel.received],
        ["Validées", d.funnel.approved],
        ["Comptes créés", d.funnel.accountsCreated],
        ["Identifiants générés", d.funnel.credentialsIssued],
      ]
    )
  );

  lines.push(
    ...section(
      "Demandes par semaine",
      ["Semaine", "Étudiant", "Parent"],
      d.weekly.map((r) => [r.weekStart, r.student, r.parent])
    )
  );

  lines.push(
    ...section(
      "Délais de traitement",
      ["Tranche", "Demandes"],
      d.processingDelays.map((r) => [r.bucket, r.count])
    )
  );

  lines.push(
    ...section(
      "Motifs de rejet",
      ["Motif", "Occurrences"],
      d.rejectionReasons.map((r) => [r.reason, r.count])
    )
  );

  lines.push(
    ...section(
      "Niveaux souhaités",
      ["Niveau", "Demandes"],
      d.desiredLevels.map((r) => [r.level, r.count])
    )
  );

  return lines.join("\r\n");
}
