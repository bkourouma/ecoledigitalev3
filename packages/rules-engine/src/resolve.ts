import { RuleEvaluationError } from './errors';
import { isValidIsoDate, type RuleSet, type RuleStatus, type RuleVersion } from './model';

/**
 * Résolution du RuleSet applicable (plan §3.8) :
 *   variante d'établissement approuvée  >  RuleSet national publié,
 * selon la date d'effet. Fonction PURE et déterministe (aucune horloge : la
 * date est un paramètre ; dates en « AAAA-MM-JJ », comparées lexicographiquement).
 */

export interface ResolveQuery {
  /** Établissement demandeur ; sans lui, seuls les RuleSets nationaux sont candidats. */
  tenantId?: string;
  /** Pays (ISO 3166-1 alpha-2). */
  countryCode: string;
  educationSystem?: string;
  level?: string;
  /** Restreint à une famille de règles (RuleSet.code). */
  code?: string;
  /** Date d'effet, « AAAA-MM-JJ ». */
  date: string;
}

export interface ResolveOptions {
  /** Statuts actifs pour une variante d'établissement. Défaut : approved, published. */
  tenantActiveStatuses?: readonly RuleStatus[];
  /** Statuts actifs pour un RuleSet national. Défaut : published. */
  nationalActiveStatuses?: readonly RuleStatus[];
}

export interface ConsideredVersion {
  ruleSetId: string;
  versionId: string;
  version: number;
  origin: 'tenant' | 'national';
  eligible: boolean;
  /** Pourquoi la version est écartée (absent si éligible). */
  reason?: string;
}

export interface ResolvedRuleSet {
  ruleSet: RuleSet;
  version: RuleVersion;
  origin: 'tenant' | 'national';
  /** Toutes les versions examinées, avec la raison des écarts : explicabilité. */
  considered: ConsideredVersion[];
}

const DEFAULT_TENANT_STATUSES: readonly RuleStatus[] = ['approved', 'published'];
const DEFAULT_NATIONAL_STATUSES: readonly RuleStatus[] = ['published'];

/** La version est-elle en vigueur à `date` ? (fin incluse) */
export function isEffectiveOn(v: Pick<RuleVersion, 'effectiveFrom' | 'effectiveTo'>, date: string): boolean {
  return v.effectiveFrom <= date && (v.effectiveTo == null || date <= v.effectiveTo);
}

function specificity(s: RuleSet, q: ResolveQuery): number {
  return (s.level !== undefined && s.level === q.level ? 2 : 0) + (s.educationSystem !== undefined && s.educationSystem === q.educationSystem ? 1 : 0);
}

function matchesAttributes(s: RuleSet, q: ResolveQuery): string | undefined {
  if (s.countryCode !== q.countryCode) return 'pays différent';
  if (q.code !== undefined && s.code !== q.code) return 'code de RuleSet différent';
  if (s.educationSystem !== undefined && s.educationSystem !== q.educationSystem) return 'système éducatif différent';
  if (s.level !== undefined && s.level !== q.level) return 'niveau différent';
  return undefined;
}

interface Candidate {
  set: RuleSet;
  version: RuleVersion;
  origin: 'tenant' | 'national';
  spec: number;
}

/** Ordre de préférence : spécificité, puis date d'effet la plus récente, puis version la plus haute, puis id. */
function better(a: Candidate, b: Candidate): boolean {
  if (a.spec !== b.spec) return a.spec > b.spec;
  if (a.version.effectiveFrom !== b.version.effectiveFrom) return a.version.effectiveFrom > b.version.effectiveFrom;
  if (a.version.version !== b.version.version) return a.version.version > b.version.version;
  return a.version.id < b.version.id;
}

/**
 * Retourne la version applicable, ou `null` si aucune. Une variante
 * d'établissement éligible l'emporte TOUJOURS sur le national, quelle que soit
 * la date d'effet de ce dernier.
 */
export function resolveRuleSet(ruleSets: readonly RuleSet[], query: ResolveQuery, options: ResolveOptions = {}): ResolvedRuleSet | null {
  if (!isValidIsoDate(query.date)) {
    throw new RuleEvaluationError({
      code: 'CONTEXTE_INVALIDE',
      phase: 'evaluation',
      message: `Date d'effet invalide « ${query.date} » (format attendu : AAAA-MM-JJ).`,
    });
  }
  const tenantStatuses = options.tenantActiveStatuses ?? DEFAULT_TENANT_STATUSES;
  const nationalStatuses = options.nationalActiveStatuses ?? DEFAULT_NATIONAL_STATUSES;

  const considered: ConsideredVersion[] = [];
  const winners: Record<'tenant' | 'national', Candidate | undefined> = { tenant: undefined, national: undefined };

  for (const set of ruleSets) {
    let origin: 'tenant' | 'national';
    if (set.scope.kind === 'national') {
      origin = 'national';
    } else if (query.tenantId !== undefined && set.scope.tenantId === query.tenantId) {
      origin = 'tenant';
    } else {
      continue; // variante d'un autre établissement : jamais candidate (ni tracée)
    }
    const mismatch = matchesAttributes(set, query);
    for (const version of set.versions) {
      const info: ConsideredVersion = { ruleSetId: set.id, versionId: version.id, version: version.version, origin, eligible: false };
      const active = origin === 'tenant' ? tenantStatuses : nationalStatuses;
      if (mismatch) info.reason = mismatch;
      else if (!active.includes(version.status)) info.reason = `statut « ${version.status} » non actif`;
      else if (!isEffectiveOn(version, query.date)) info.reason = `hors période d'effet (${version.effectiveFrom} → ${version.effectiveTo ?? '∞'})`;
      else info.eligible = true;
      considered.push(info);
      if (!info.eligible) continue;
      const cand: Candidate = { set, version, origin, spec: specificity(set, query) };
      const cur = winners[origin];
      if (!cur || better(cand, cur)) winners[origin] = cand;
    }
  }

  const win = winners.tenant ?? winners.national;
  if (!win) return null;
  return { ruleSet: win.set, version: win.version, origin: win.origin, considered };
}

export interface VersionOverlap {
  a: { id: string; version: number };
  b: { id: string; version: number };
  /** Premier jour commun. */
  from: string;
  /** Dernier jour commun, ou null si ouvert. */
  to: string | null;
}

/**
 * Détecte les chevauchements de période entre versions d'un même RuleSet dont
 * le statut est actif : à vérifier avant d'approuver/publier une version.
 */
export function findEffectiveOverlaps(
  ruleSet: RuleSet,
  activeStatuses: readonly RuleStatus[] = ['approved', 'published'],
): VersionOverlap[] {
  const active = ruleSet.versions.filter((v) => activeStatuses.includes(v.status)).sort((x, y) => x.version - y.version);
  const out: VersionOverlap[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i] as RuleVersion;
      const b = active[j] as RuleVersion;
      const from = a.effectiveFrom > b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom;
      const aEnd = a.effectiveTo ?? null;
      const bEnd = b.effectiveTo ?? null;
      const to = aEnd === null ? bEnd : bEnd === null ? aEnd : aEnd < bEnd ? aEnd : bEnd;
      if (to === null || from <= to) {
        out.push({ a: { id: a.id, version: a.version }, b: { id: b.id, version: b.version }, from, to });
      }
    }
  }
  return out;
}
