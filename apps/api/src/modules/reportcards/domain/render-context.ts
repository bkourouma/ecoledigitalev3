/**
 * Contexte de rendu d'un document : dérivé PUREMENT du snapshot (R-RC-12 : zéro calcul métier au rendu ; on ne fait que
 * mettre en forme — numéros d'ordre, regroupement UE/ECUE, libellés de la table `labels` du snapshot, durées en heures).
 *
 * Le contexte ne contient que des chaînes, booléens et listes : rien d'exécutable, rien qui provienne d'ailleurs que du
 * snapshot, des options résolues et des éléments de vérification.
 */
import { DEMONSTRATION_NOTICE, isDemonstrationSource } from "./constants";
import type { ReportcardSnapshot, ReportcardSnapshotLine } from "./types";

export interface VerificationInfo {
  readonly code: string;
  readonly url: string;
  /** SVG du QR (sortie de `qrToSvg`, de confiance) ; `null` pour un document provisoire (non vérifiable). */
  readonly qrSvg: string | null;
}

const DEFAULT_PRIMARY = "#1f3a5f";
const DEFAULT_SECONDARY = "#5b7aa3";
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** « 2.50 » -> « 2,5 » ; « 6.00 » -> « 6 ». */
export function fmtCount(value: string | null): string {
  if (value === null) return "";
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [int, frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${int},${trimmed}` : `${int}`;
}

export function rankText(rank: number | null, of: number | null): string {
  if (rank === null || rank <= 0) return "--";
  const ord = rank === 1 ? "1er" : `${rank}e`;
  return of ? `${ord} / ${of}` : ord;
}

/** Durée en minutes -> « 2 h 30 » / « 45 min » / « 0 h ». */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0 h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

export interface RowContext {
  code: string;
  label: string;
  isSection: boolean;
  indent: number;
  coefficient: string;
  credits: string;
  exact: string;
  display: string;
  weighted: string;
  rankText: string;
  stateLabel: string;
  session: string;
  mentionLabel: string;
  appreciation: string;
  periodLabel: string;
}

export interface GroupContext {
  code: string;
  label: string;
  hasLabel: boolean;
  category: string;
  header: RowContext | null;
  rows: RowContext[];
}

function rowOf(line: ReportcardSnapshotLine, labels: Readonly<Record<string, string>>): RowContext {
  const lab = (code: string | null): string => (code ? labels[code] ?? code : "");
  return {
    code: line.code,
    label: line.label,
    isSection: line.level === "SECTION" || line.level === "UE",
    indent: line.level === "ECUE" ? 1 : 0,
    coefficient: fmtCount(line.coefficient),
    credits: fmtCount(line.credits),
    exact: line.exact ?? "",
    display: line.display ?? "",
    weighted: line.weighted ?? "",
    rankText: line.rank ? rankText(line.rank, line.rankOf) : "",
    stateLabel: lab(line.state),
    session: line.session ? `Session ${line.session}` : "",
    mentionLabel: lab(line.mention),
    appreciation: line.appreciation ?? "",
    periodLabel: line.periodLabel ?? "",
  };
}

/** Regroupe les lignes : sections / UE et leurs enfants (par `parentCode`), sinon par catégorie, sinon un seul groupe. */
export function groupLines(lines: readonly ReportcardSnapshotLine[], labels: Readonly<Record<string, string>>): GroupContext[] {
  const parents = lines.filter((l) => l.level === "SECTION" || l.level === "UE");
  const parentCodes = new Set(parents.map((p) => p.code));
  const groups: GroupContext[] = [];
  const orphans = lines.filter((l) => !(l.level === "SECTION" || l.level === "UE") && (l.parentCode === null || !parentCodes.has(l.parentCode)));
  if (parents.length === 0) {
    const categories = new Map<string, ReportcardSnapshotLine[]>();
    for (const l of orphans) {
      const key = l.category ?? "";
      categories.set(key, [...(categories.get(key) ?? []), l]);
    }
    for (const [category, list] of categories) {
      groups.push({ code: category, label: category ? (labels[category] ?? category) : "", hasLabel: category !== "", category, header: null, rows: list.map((l) => rowOf(l, labels)) });
    }
    return groups;
  }
  if (orphans.length) groups.push({ code: "", label: "", hasLabel: false, category: "", header: null, rows: orphans.map((l) => rowOf(l, labels)) });
  for (const p of parents) {
    groups.push({
      code: p.code,
      label: p.label,
      hasLabel: true,
      category: p.category ?? "",
      header: rowOf(p, labels),
      rows: lines.filter((l) => l.parentCode === p.code && !(l.level === "SECTION" || l.level === "UE")).map((l) => rowOf(l, labels)),
    });
  }
  return groups;
}

export interface CompetencyDomainContext {
  code: string;
  label: string;
  evaluated: string;
  expected: string;
  levels: Array<{ code: string; label: string; count: string }>;
  levelsText: string;
}

export interface RenderContext {
  title: string;
  provisional: boolean;
  isTranscript: boolean;
  /** Les résultats viennent d'un jeu de règles de DÉMONSTRATION : filigrane et mention imprimée (`DEMONSTRATION_NOTICE`). */
  demonstration: boolean;
  demonstrationNotice: string;
  institution: {
    legalName: string; shortName: string; headerLeft: string[]; headerRight: string[]; contactLine: string;
    address: string; phone: string; email: string; website: string; registrationRef: string; footerText: string;
  };
  student: { fullName: string; lastName: string; firstNames: string; matricule: string; birthDate: string; birthPlace: string; gender: string; nationality: string; repeatingText: string };
  enrollment: {
    classroomLabel: string;
    levelLabel: string;
    programLabel: string;
    academicYearLabel: string;
    periodLabel: string;
    classSize: string;
    /** « Affecté(e) » si le TYPE DE FINANCEMENT de l'inscription est l'affectation par l'État ; vide sinon (jamais déduit d'un texte de décision). */
    stateAssignedText: string;
    stateAssigned: boolean;
  };
  /** Compétences par domaine (primaire / maternelle) ; `null` pour un bulletin numérique. */
  competencies: { scaleLabel: string; domains: CompetencyDomainContext[] } | null;
  options: Record<string, unknown>;
  /**
   * Drapeaux d'AFFICHAGE résolus (gabarits du primaire v2 : décisions Q-P04 et Q-P05). `rank` : l'option `showRank` est active ET un rang existe
   * (la maternelle, sans note, n'en a jamais : ni colonne ni ligne « Rang ») ; `mention` : l'option `showMention` est active ET la règle a produit
   * une mention. Aucune valeur n'est calculée ici : on décide seulement de montrer ou non ce que `results` a produit.
   */
  show: { rank: boolean; mention: boolean };
  groups: GroupContext[];
  rows: RowContext[];
  summary: {
    averageDisplay: string; rankText: string; classSize: string; classAverageDisplay: string; mentionLabel: string; decisionLabel: string; decisionOutcome: string;
    creditsAcquired: string; creditsRequired: string; hasCredits: boolean; totalCoefficient: string; weightedTotal: string; distinctions: string[];
  };
  annual: { rows: Array<{ label: string; display: string; weight: string }>; averageDisplay: string; rankText: string; decisionLabel: string } | null;
  attendance: { justified: string; unjustified: string; lateCount: string } | null;
  deliberation: { heldOn: string; natureLabel: string } | null;
  appreciation: string;
  signatories: Array<{ slot: string; slotLabel: string; name: string; title: string; jobFunction: string }>;
  colors: { primary: string; secondary: string };
  labels: Readonly<Record<string, string>>;
  meta: { issuedAt: string; version: number; versionText: string; code: string; verifyUrl: string; hasQr: boolean };
}

export function buildRenderContext(snapshot: ReportcardSnapshot, verification: VerificationInfo | null): RenderContext {
  const s = snapshot;
  const labels = s.labels;
  const lab = (code: string | null): string => (code ? labels[code] ?? code : "");
  const inst = s.institution;
  const contact = [inst.address, inst.phone ? `Tél : ${inst.phone}` : null, inst.email, inst.website].filter((x): x is string => Boolean(x)).join(" — ");
  const sum = s.results.summary;
  const fullName = [s.student.lastName.toLocaleUpperCase("fr-FR"), s.student.firstNames].filter(Boolean).join(" ");
  const hasQr = Boolean(verification?.qrSvg) && !s.meta.provisional;
  return {
    title: s.meta.title,
    provisional: s.meta.provisional,
    isTranscript: s.meta.kind === "TRANSCRIPT",
    demonstration: isDemonstrationSource(s.rules.sourceKind),
    demonstrationNotice: isDemonstrationSource(s.rules.sourceKind) ? DEMONSTRATION_NOTICE : "",
    institution: {
      legalName: inst.legalName,
      shortName: inst.shortName ?? "",
      headerLeft: [...inst.headerLeft],
      headerRight: [...inst.headerRight],
      contactLine: contact,
      address: inst.address ?? "",
      phone: inst.phone ?? "",
      email: inst.email ?? "",
      website: inst.website ?? "",
      registrationRef: inst.registrationRef ?? "",
      footerText: inst.footerText ?? "",
    },
    student: {
      fullName,
      lastName: s.student.lastName,
      firstNames: s.student.firstNames,
      matricule: s.student.matricule ?? "",
      birthDate: s.student.birthDate ?? "",
      birthPlace: s.student.birthPlace ?? "",
      gender: s.student.gender ?? "",
      nationality: s.student.nationality ?? "",
      repeatingText: s.student.repeating === null ? "" : s.student.repeating ? "Oui" : "Non",
    },
    enrollment: {
      classroomLabel: s.enrollment.classroomLabel ?? "",
      levelLabel: s.enrollment.levelLabel ?? "",
      programLabel: s.enrollment.programLabel ?? "",
      academicYearLabel: s.enrollment.academicYearLabel,
      periodLabel: s.enrollment.periodLabel ?? "",
      classSize: s.enrollment.classSize === null ? "" : String(s.enrollment.classSize),
      stateAssigned: s.enrollment.stateAssigned === true,
      stateAssignedText: s.enrollment.stateAssigned === true ? "Affecté(e)" : "",
    },
    competencies: s.competencies
      ? {
          scaleLabel: s.competencies.scaleLabel ?? "",
          domains: s.competencies.domains.map((d) => ({
            code: d.code,
            label: d.label,
            evaluated: String(d.evaluated),
            expected: String(d.expected),
            levels: d.levels.map((l) => ({ code: l.code, label: l.label, count: String(l.count) })),
            levelsText: d.levels.map((l) => `${l.label} : ${l.count}`).join(" — "),
          })),
        }
      : null,
    options: { ...s.template.options },
    show: {
      rank: s.template.options.showRank !== false && (sum.rank !== null || s.results.lines.some((l) => l.rank !== null && l.rank > 0)),
      mention: s.template.options.showMention !== false && Boolean(sum.mention),
    },
    groups: groupLines(s.results.lines, labels),
    rows: s.results.lines.map((l) => rowOf(l, labels)),
    summary: {
      averageDisplay: sum.averageDisplay ?? "",
      rankText: rankText(sum.rank, sum.classSize),
      classSize: sum.classSize === null ? "" : String(sum.classSize),
      classAverageDisplay: sum.classAverageDisplay ?? "",
      mentionLabel: lab(sum.mention),
      decisionLabel: lab(sum.decisionCode),
      decisionOutcome: lab(sum.decisionOutcome),
      creditsAcquired: fmtCount(sum.creditsAcquired),
      creditsRequired: fmtCount(sum.creditsRequired),
      hasCredits: sum.creditsAcquired !== null || sum.creditsRequired !== null,
      totalCoefficient: fmtCount(sum.totalCoefficient),
      weightedTotal: sum.weightedTotal ?? "",
      distinctions: [...sum.distinctions],
    },
    annual: s.results.annual
      ? {
          rows: s.results.annual.rows.map((r) => ({ label: r.label, display: r.display ?? "", weight: r.weight ?? "" })),
          averageDisplay: s.results.annual.averageDisplay ?? "",
          rankText: rankText(s.results.annual.rank, s.results.annual.classSize),
          decisionLabel: lab(s.results.annual.decisionCode),
        }
      : null,
    attendance: s.attendance
      ? { justified: formatMinutes(s.attendance.justifiedMinutes), unjustified: formatMinutes(s.attendance.unjustifiedMinutes), lateCount: String(s.attendance.lateCount) }
      : null,
    deliberation: s.deliberation ? { heldOn: s.deliberation.heldOn, natureLabel: s.deliberation.nature === "JURY" ? "du jury" : "du conseil de classe" } : null,
    appreciation: s.appreciations.general ?? "",
    signatories: s.signatories.map((x) => ({ slot: x.slot, slotLabel: x.slotLabel, name: x.name, title: x.title ?? "", jobFunction: x.jobFunction ?? "" })),
    colors: {
      primary: inst.primaryColor && HEX.test(inst.primaryColor) ? inst.primaryColor : DEFAULT_PRIMARY,
      secondary: inst.secondaryColor && HEX.test(inst.secondaryColor) ? inst.secondaryColor : DEFAULT_SECONDARY,
    },
    labels,
    meta: {
      issuedAt: s.meta.issuedAt,
      version: s.meta.version,
      versionText: s.meta.version > 1 ? `Version ${s.meta.version}` : "",
      code: verification && !s.meta.provisional ? verification.code : "",
      verifyUrl: verification && !s.meta.provisional ? verification.url : "",
      hasQr,
    },
  };
}
