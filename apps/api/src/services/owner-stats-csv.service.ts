import type {
  OwnerAssiduiteResponse,
  OwnerFinancesProResponse,
  OwnerPedagogieResponse,
  OwnerPersonnesResponse,
  OwnerPayrollResponse,
  OwnerProspectionResponse,
  OwnerRecrutementResponse,
} from "@ecoledigitale/contracts";
import { OWNER_PROSPECTION_CANAL_LABELS } from "@ecoledigitale/contracts";

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
  // Le nom de classe fait partie du périmètre : un CSV se relit hors de l'écran
  // qui l'a produit, et « 18 000 000 » ne dit pas de quelle classe il parle.
  lines.push(
    row([
      "Nom de classe",
      d.nomClasse ? d.nomClasse.split("|").slice(1).join("|") : "Toutes",
    ])
  );
  lines.push(
    row([
      "UE « Conduite »",
      `Incluses — ${Math.round(d.totals.conduite.expected)} FCFA, écartées par l'écran admin des paiements`,
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
        [
          "Taux de recouvrement (%)",
          d.totals.recoveryRate === null ? "non mesuré" : num(d.totals.recoveryRate, 1),
          "Encaissé / attendu — « non mesuré » quand rien n'est attendu",
        ],
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
  // Le périmètre en tête : un CSV se relit hors de l'écran qui l'a produit, et
  // « 20 étudiants » ne veut rien dire sans l'année à laquelle ils étaient là.
  lines.push(
    row(["Périmètre", d.anneeScolaire ?? "Toutes années cumulées"])
  );
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

/**
 * Masse salariale.
 *
 * Le fichier s'ouvre sur les filtres appliqués, comme les autres : un tableur de
 * paie sans son périmètre se confond avec celui de l'exercice voisin. La ligne
 * « hors total » y figure explicitement — un montant annulé ou contesté retiré
 * du total en silence produit un écart qu'on ne sait plus expliquer six mois
 * plus tard.
 */
export function buildOwnerPayrollCsv(d: OwnerPayrollResponse): string {
  const lines: string[] = [];

  lines.push(row(["Masse salariale enseignante"]));
  lines.push(row(["Année scolaire", d.anneeScolaire ?? "Toutes"]));
  lines.push(row(["Période de paie", d.periodName ?? "Toutes"]));
  lines.push(row(["Enseignant", d.teacherName ?? "Tous"]));
  lines.push(row(["Statut", d.status ?? "Tous"]));
  lines.push(row(["Archivage", d.archive]));
  lines.push("");

  lines.push(
    ...section(
      "Indicateurs",
      ["Indicateur", "Valeur", "Règle de calcul"],
      [
        [
          "Masse salariale (FCFA)",
          num(d.kpis.masseSalariale, 0),
          "Somme des bulletins calculés, approuvés, payés ou impayés",
        ],
        ["Bulletins", d.kpis.bulletins, "Bulletins comptés dans la masse"],
        ["Enseignants payés", d.kpis.enseignantsPayes, "Enseignants distincts"],
        [
          "Coût moyen par enseignant (FCFA)",
          num(d.kpis.coutMoyenParEnseignant, 0),
          "Masse salariale / enseignants payés",
        ],
        [
          "En attente de validation",
          d.kpis.enAttenteValidation,
          `${num(d.kpis.montantEnAttente, 0)} FCFA au statut « calculé »`,
        ],
        [
          "Approuvé non versé",
          d.kpis.approuveNonVerse,
          `${num(d.kpis.montantApprouveNonVerse, 0)} FCFA engagés, date de versement absente`,
        ],
        [
          "Hors total (FCFA)",
          num(d.kpis.montantHorsTotal, 0),
          "Bulletins annulés ou contestés, exclus de la masse salariale",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Décomposition",
      ["Poste", "Montant (FCFA)"],
      [
        ["Base", num(d.breakdown.base, 0)],
        ["Heures supplémentaires", num(d.breakdown.heuresSup, 0)],
        ["Primes", num(d.breakdown.primes, 0)],
        ["Retenues", num(d.breakdown.retenues, 0)],
        ["Total", num(d.breakdown.total, 0)],
      ]
    )
  );

  lines.push(
    ...section(
      "Évolution par période de paie",
      ["Période", "Début", "Bulletins", "Enseignants payés", "Montant (FCFA)"],
      d.byPeriod.map((p) => [
        p.name,
        p.periodStart,
        p.bulletins,
        p.enseignantsPayes,
        num(p.montant, 0),
      ])
    )
  );

  lines.push(
    ...section(
      "Coût par enseignant",
      [
        "Enseignant",
        "Courriel",
        "Bulletins",
        "Base",
        "Heures sup.",
        "Primes",
        "Retenues",
        "Total (FCFA)",
      ],
      d.byTeacher.map((t) => [
        t.teacherName,
        t.email ?? "",
        t.bulletins,
        num(t.base, 0),
        num(t.heuresSup, 0),
        num(t.primes, 0),
        num(t.retenues, 0),
        num(t.total, 0),
      ])
    )
  );

  lines.push(
    ...section(
      d.bulletins.length < d.bulletinsTotal
        ? `Bulletins (${d.bulletins.length} sur ${d.bulletinsTotal})`
        : `Bulletins (${d.bulletinsTotal})`,
      [
        "Enseignant",
        "Période",
        "Année scolaire",
        "Statut",
        "Archivé le",
        "Versé le",
        "Montant (FCFA)",
      ],
      d.bulletins.map((b) => [
        b.teacherName,
        b.periodName ?? "",
        b.anneeScolaire ?? "",
        b.status,
        b.archivedAt ? b.archivedAt.slice(0, 10) : "",
        b.paidAt ? b.paidAt.slice(0, 10) : "",
        num(b.amount, 0),
      ])
    )
  );

  lines.push(
    ...section(
      "Paies en attente de validation",
      ["Enseignant", "Période", "Calculée le", "Montant (FCFA)"],
      d.pending.map((p) => [
        p.teacherName,
        p.periodName ?? "",
        p.calculatedAt ? p.calculatedAt.slice(0, 10) : "",
        num(p.amount, 0),
      ])
    )
  );

  lines.push(
    ...section(
      `Cours sans titulaire actif (${d.coursesWithoutTeacher.length} sur ${d.coursesWithoutTeacherTotal})`,
      ["Classe", "Cours"],
      d.coursesWithoutTeacher.map((c) => [c.className, c.courseName])
    )
  );

  if (d.coursesWithoutTeacherOrphaned > 0) {
    lines.push(
      row([
        "Rattachements non listables",
        d.coursesWithoutTeacherOrphaned,
        "Classe ou matière référencée absente en base — données à réparer",
      ])
    );
    lines.push("");
  }

  return lines.join("\r\n");
}

/**
 * Prospection — d'où viennent les étudiants et ce que coûtent les commerciaux.
 *
 * La couverture de la saisie ouvre le fichier, avant toute répartition : un
 * tableur qui circule sans elle donnerait des parts de canal pour des parts
 * d'école.
 */
export function buildOwnerProspectionCsv(d: OwnerProspectionResponse): string {
  const lines: string[] = [];

  lines.push(row(["Prospection — provenance des étudiants et commissions"]));
  lines.push(row(["Année scolaire", d.anneeScolaire ?? "Toutes années"]));
  lines.push(
    row([
      "Périmètre",
      // Le nom de classe prime : c est le filtre le plus etroit, et celui que
      // le lecteur du fichier doit voir en premier.
      d.nomClasse
        ? `Classe : ${d.nomClasse.split("|").pop()}`
        : d.filiereIds.length > 0
          ? `${d.filiereIds.length} filière(s)`
          : "Toutes filières",
    ])
  );
  lines.push("");

  lines.push(
    ...section(
      "Couverture de la saisie",
      ["Indicateur", "Valeur", "Règle de calcul"],
      [
        ["Étudiants du périmètre", d.couverture.etudiants, ""],
        ["Provenance renseignée", d.couverture.renseignes, ""],
        ["Provenance inconnue", d.couverture.nonRenseignes, ""],
        [
          "Couverture (%)",
          num(d.kpis.couverture, 1),
          "Renseignés / étudiants du périmètre",
        ],
        [
          "Scolarité non rattachée (FCFA)",
          num(d.couverture.scolariteNonRattachee, 0),
          "Encaissements des étudiants dont la provenance est inconnue",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Indicateurs",
      ["Indicateur", "Valeur", "Règle de calcul"],
      [
        [
          "Scolarité encaissée (FCFA)",
          num(d.kpis.scolariteEncaissee, 0),
          "Ligne Scolarité du barème (natures ue et scolarite), paiements confirmés",
        ],
        ["Étudiants amenés par un commercial", d.kpis.viaCommercial, ""],
        [
          "Commission acquise (FCFA)",
          num(d.kpis.commissionAcquise, 0),
          "Paiement par paiement : montant × taux figé sur la fiche de l'étudiant",
        ],
        ["Commission versée (FCFA)", num(d.kpis.commissionVersee, 0), ""],
        [
          "Commission due (FCFA)",
          num(d.kpis.commissionDue, 0),
          "Lignes de commission non encore réglées",
        ],
        [
          "Taux effectif (%)",
          num(d.kpis.tauxEffectif, 2),
          "Commission acquise / scolarité encaissée via commercial",
        ],
      ]
    )
  );

  lines.push(
    ...section(
      "Par canal",
      [
        "Canal",
        "Étudiants",
        "Part (%)",
        "Scolarité encaissée",
        "Par étudiant",
        "Commission",
        "Net pour l'école",
      ],
      d.parCanal.map((c) => [
        OWNER_PROSPECTION_CANAL_LABELS[c.canal],
        c.etudiants,
        num(c.part, 1),
        num(c.scolariteEncaissee, 0),
        num(c.scolariteParEtudiant, 0),
        num(c.commissionAcquise, 0),
        num(c.net, 0),
      ])
    )
  );

  lines.push(
    ...section(
      "Arrivées par mois",
      ["Mois", "Total", "Commercial", "Médias", "Bouche-à-oreille", "Autre / inconnu"],
      d.parMois.map((m) => [
        m.mois,
        m.total,
        m.commercial,
        m.medias,
        m.boucheAOreille,
        m.autre,
      ])
    )
  );

  lines.push(
    ...section(
      "Commerciaux",
      [
        "Commercial",
        "Actif",
        "Étudiants",
        "Scolarité encaissée",
        "Commission acquise",
        "Versée",
        "Reste dû",
        "Taux effectif (%)",
        "Lignes à régler",
      ],
      d.commerciaux.map((c) => [
        c.nom,
        c.actif ? "Oui" : "Non",
        c.etudiants,
        num(c.scolariteEncaissee, 0),
        num(c.commissionAcquise, 0),
        num(c.commissionVersee, 0),
        num(c.solde, 0),
        num(c.tauxEffectif, 2),
        c.lignesDues,
      ])
    )
  );

  lines.push(
    ...section(
      "Dette de commissions",
      ["Indicateur", "Valeur"],
      [
        ["Montant dû (FCFA)", num(d.dette.total, 0)],
        ["Lignes à régler", d.dette.lignes],
        ["Commerciaux concernés", d.dette.commerciaux],
        ["Plus ancien encaissement dû", d.dette.plusAncienne ?? "—"],
        ["Ancienneté (jours)", d.dette.ageJours ?? "—"],
      ]
    )
  );

  if (d.etudiantsSansDate > 0) {
    lines.push(
      row([
        "Étudiants absents de la courbe mensuelle",
        d.etudiantsSansDate,
        "Aucune ouverture de classe ne les date — comptés dans les totaux, pas dans les mois",
      ])
    );
    lines.push("");
  }

  return lines.join("\r\n");
}
