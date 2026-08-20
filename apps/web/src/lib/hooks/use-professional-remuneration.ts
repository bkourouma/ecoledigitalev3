"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";

/**
 * Hooks — Rémunération du Module Professionnel (feature 031).
 * Via `/api/v1/professional/remuneration/*`.
 *
 * Ne couvre que ce qui est propre au professionnel : la validation des séances
 * (source des heures) et les tarifs par ECUE. Les périodes, le calcul et les
 * rapports restent les écrans partagés sous `/payments`.
 */

const BASE = "/api/v1/professional/remuneration";

async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...createApiHeaders(),
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (init?.body == null) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

const jsonInit = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export type SeanceStatut = "planifiee" | "realisee" | "annulee";

export type SeanceBlocker =
  | "STATUT_NON_REALISEE"
  | "NON_VALIDEE"
  | "SANS_ENSEIGNANT"
  | "HORAIRES_INCOMPLETS"
  | "DEJA_PAYEE";

export interface SeancePaie {
  id: string;
  date: string;
  heure_debut: string | null;
  heure_fin: string | null;
  /** Durée retenue pour la paie : dérogation si elle existe, sinon horaires. */
  duree_heures: number | null;
  /** Durée déduite des horaires — le prévu, à afficher à côté du payé. */
  duree_planifiee: number | null;
  /** Dérogation comptable. NULL = la durée vient des horaires. */
  duree_payee: number | null;
  duree_payee_le: string | null;
  duree_payee_par_nom: string | null;
  saisie_comptable: boolean;
  statut: SeanceStatut;
  seance_libelle: string | null;
  validated_at: string | null;
  validated_by: string | null;
  validated_by_nom: string | null;
  payable: boolean;
  blockers: SeanceBlocker[];
  enseignant_id: string | null;
  enseignant_nom: string | null;
  ecue_id: string;
  ecue_code: string | null;
  ecue_libelle: string | null;
  ue_session_id: string;
  cohorte_libelle: string | null;
  semestre_id: string | null;
  semestre_libelle: string | null;
  filiere_id: string | null;
  filiere_nom: string | null;
  presences_saisies: number;
  paiement_id: string | null;
  paiement_statut: string | null;
}

export interface SeanceFilters {
  enseignantId?: string;
  ueSessionId?: string;
  ecueId?: string;
  /** Filière portant la cohorte, via son semestre. */
  filiereId?: string;
  fromDate?: string;
  toDate?: string;
  /** « AAAA-AAAA+1 », pivot septembre. Découpé en base, pas ici. */
  anneeScolaire?: string;
  statut?: SeanceStatut;
  validated?: boolean;
  payable?: boolean;
  hasAttendance?: boolean;
  limit?: number;
  offset?: number;
}

function toQuery(filters: SeanceFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || value === null) continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Séances de la période, avec leur payabilité et ses motifs. */
/** Agrégats du périmètre filtré ENTIER — la liste, elle, est paginée. */
export interface SeanceSummary {
  /** Séances rattachées à un paiement, sur tout le périmètre filtré. */
  avec_paiement: number;
  pretes: number;
  heures_pretes: number;
  payables: number;
  heures_payables: number;
}

export function useSeancesPaie(filters: SeanceFilters, enabled = true) {
  return useQuery<{
    items: SeancePaie[];
    total: number;
    limit: number;
    offset: number;
    summary?: SeanceSummary;
  }>({
    queryKey: ["prof-remuneration", "seances", filters],
    queryFn: () => apiFetch(`${BASE}/seances${toQuery(filters)}`),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Années scolaires disponibles, la plus récente en premier. Vient de l'API :
 * les déduire des séances affichées ferait disparaître une année du filtre dès
 * que la pagination la tronque.
 */
/**
 * Enseignants ayant au moins une séance réalisée non validée — la liste du
 * filtre de l'écran « À traiter ». Vient de l'API : la déduire des lignes
 * affichées ferait disparaître un enseignant du filtre dès que la pagination
 * tronque ses séances.
 */
/** Une séance et tout son contexte — alimente la fiche de détail. */
export interface SeanceDetail extends SeancePaie {
  presences_detail: Array<{ statut: string; n: number }>;
  lignes_paiement: Array<{
    id: string;
    statut: string;
    total: number;
    currency: string;
    periode: string | null;
    heures: number;
    tarif: number;
    montant: number;
    is_overtime: boolean;
  }>;
}

export function useSeanceDetail(id: string | null) {
  return useQuery<SeanceDetail>({
    queryKey: ["prof-remuneration", "seance", id],
    queryFn: () => apiFetch(`${BASE}/seances/${id}`),
    enabled: !!id,
  });
}

export function useEnseignantsATraiter() {
  return useQuery<Array<{ id: string; nom: string; nb_seances: number }>>({
    queryKey: ["prof-remuneration", "seances", "enseignants-a-traiter"],
    queryFn: () => apiFetch(`${BASE}/seances/enseignants`),
    staleTime: 30_000,
  });
}

export function useSeanceAnneesScolaires(enabled = true) {
  return useQuery<string[]>({
    queryKey: ["prof-remuneration", "seances", "annees-scolaires"],
    queryFn: () => apiFetch(`${BASE}/seances/annees-scolaires`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Chevauchements d'horaires — à traiter AVANT validation (double paiement). */
export function useSeanceOverlaps(
  params: { fromDate?: string; toDate?: string; enseignantId?: string },
  enabled = true
) {
  return useQuery<any[]>({
    queryKey: ["prof-remuneration", "overlaps", params],
    queryFn: () => apiFetch(`${BASE}/seances/overlaps${toQuery(params as SeanceFilters)}`),
    enabled,
    staleTime: 60_000,
  });
}

export function useSetSeanceStatut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: SeanceStatut }) =>
      apiFetch(`${BASE}/seances/${id}/statut`, jsonInit("PATCH", { statut })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration"] }),
  });
}

/**
 * Validation en lot. Retourne `{ updated, rejected }` : le lot est appliqué
 * PARTIELLEMENT, l'écran doit donc afficher les rejets et leur motif plutôt
 * que d'annoncer un succès global.
 */
export function useValidateSeances() {
  const qc = useQueryClient();
  return useMutation<
    { updated: number; rejected: Array<{ seanceId: string; reason: SeanceBlocker }> },
    Error,
    { seanceIds: string[]; validated: boolean }
  >({
    mutationFn: (payload) => apiFetch(`${BASE}/seances/validate`, jsonInit("POST", payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration"] }),
  });
}

export interface SeanceManquante {
  ue_session_id: string;
  ecue_id: string;
  enseignant_id: string | null;
  date: string;
  heure_debut: string | null;
  heure_fin: string | null;
  duree_attendue: number | null;
  ecue_code: string | null;
  ecue_libelle: string | null;
  cohorte_libelle: string | null;
  enseignant_nom: string | null;
}

/**
 * Dérogation comptable sur le volume horaire. `duree: null` la retire et
 * redonne la main aux horaires.
 */
export function useSetSeanceDuree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, duree }: { id: string; duree: number | null }) =>
      apiFetch(`${BASE}/seances/${id}/duree`, jsonInit("PATCH", { duree })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration"] }),
  });
}

/** Séance ajoutée depuis l'écran de paie (marquée `saisie_comptable`). */
export function useCreateSeanceComptable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      ue_session_id: string;
      ecue_id: string;
      enseignant_id: string;
      date: string;
      heure_debut?: string | null;
      heure_fin?: string | null;
      duree_payee?: number | null;
      libelle?: string | null;
    }) => apiFetch(`${BASE}/seances`, jsonInit("POST", payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration"] }),
  });
}

/**
 * Créneaux d'emploi du temps attendus sans séance enregistrée — ce qui permet
 * de savoir quelle séance manque, au lieu d'en ajouter à l'aveugle.
 */
export function useSeancesManquantes(
  params: { fromDate?: string; toDate?: string },
  enabled = true
) {
  return useQuery<SeanceManquante[]>({
    queryKey: ["prof-remuneration", "manquantes", params],
    queryFn: () => apiFetch(`${BASE}/seances/manquantes${toQuery(params as SeanceFilters)}`),
    enabled: enabled && Boolean(params.fromDate && params.toDate),
    staleTime: 30_000,
  });
}

/* ----------------------------- Tarifs ECUE ----------------------------- */

export interface EcueHourlyRate {
  id: string;
  ecue_id: string;
  ecue_code?: string | null;
  ecue_libelle?: string | null;
  enseignant_id: string | null;
  enseignant_nom?: string | null;
  montant_horaire: number;
  devise: string;
  valide_du: string;
  valide_au: string | null;
  notes: string | null;
}

export function useEcueRates(
  params: { ecueId?: string; enseignantId?: string; activeOn?: string } = {}
) {
  return useQuery<EcueHourlyRate[]>({
    queryKey: ["prof-remuneration", "ecue-rates", params],
    queryFn: () => apiFetch(`${BASE}/ecue-rates${toQuery(params as SeanceFilters)}`),
    staleTime: 60_000,
  });
}

export function useCreateEcueRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<EcueHourlyRate>) =>
      apiFetch(`${BASE}/ecue-rates`, jsonInit("POST", payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration", "ecue-rates"] }),
  });
}

export function useDeleteEcueRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/ecue-rates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration", "ecue-rates"] }),
  });
}

/** Libellés des motifs de non-payabilité, pour l'affichage. */
export const BLOCKER_LABELS: Record<SeanceBlocker, string> = {
  STATUT_NON_REALISEE: "Non marquée réalisée",
  NON_VALIDEE: "Non validée",
  SANS_ENSEIGNANT: "Aucun enseignant",
  HORAIRES_INCOMPLETS: "Horaires incomplets",
  DEJA_PAYEE: "Déjà payée",
};

/* ==================== Bulletins de paie — enseignants ==================== */

export type EtatConfiguration = "active" | "expiree" | "future" | "absente";

export interface ConfigPaie {
  id: string;
  config_type: "salary" | "hourly" | "mixed" | string;
  monthly_salary: number | null;
  annual_salary: number | null;
  default_hourly_rate: number | null;
  overtime_threshold: number | null;
  overtime_multiplier: number | null;
  effective_from: string | null;
  effective_to: string | null;
}

/**
 * Cumul des heures payables d'un enseignant (réalisées, validées, avec
 * bénéficiaire et durée connue).
 *
 * Bornées à la PÉRIODE COURANTE, pas cumulées depuis toujours : l'écran suit
 * un cycle, et le compteur retombe à zéro une fois les bulletins archivés.
 */
export interface HeuresEnseignant {
  nb_seances: number;
  totales: number;
  premiere_seance: string | null;
  derniere_seance: string | null;
}

export interface EnseignantPaie {
  id: string;
  nom: string;
  email: string | null;
  matricule: string | null;
  statut: string | null;
  type_contrat: string | null;
  /** `active` seul garantit qu'un calcul produira quelque chose pour lui. */
  etat_configuration: EtatConfiguration;
  /** Séances réalisées mais NON validées sur la période : la paie les sautera. */
  seances_a_valider: number;
  nb_configs: number;
  /** Cumul des heures payables — voir `HeuresEnseignant`. */
  heures: HeuresEnseignant;
  /** Bulletin le plus récent NON archivé, ou null. */
  bulletin: BulletinCourant | null;
  nb_bulletins_archives: number;
  config: ConfigPaie | null;
}

/**
 * Tous les enseignants du tenant, par ordre alphabétique, avec leur
 * configuration de paie courante.
 *
 * Non paginé et volontairement : l'écran sert à repérer les enseignants NON
 * configurés, et une liste tronquée en cacherait précisément certains.
 */
export function useEnseignantsPaie() {
  return useQuery<{
    items: EnseignantPaie[];
    total: number;
    non_configures: number;
    heures_validees: number;
    seances_validees: number;
    /**
     * TOUS les bulletins encore au plan de travail, et le sort que l'archivage
     * leur réserve. Compté côté serveur : les cartes n'en montrent qu'un par
     * enseignant, s'y fier sous-estimait le reste à classer.
     */
    en_attente: { total: number; payes: number; impayes: number };
    /** Période qui pilote l'écran.  = aucune ouverte. */
    periode_courante: {
      id: string;
      nom: string;
      debut: string;
      fin: string;
      /** Des bulletins existent déjà pour cette période. */
      a_bulletins: boolean;
      /** 0 = période collective. */
      nb_cibles: number;
    } | null;
  }>({
    queryKey: ["prof-remuneration", "bulletins", "enseignants"],
    queryFn: () => apiFetch(`${BASE}/bulletins/enseignants`),
    staleTime: 30_000,
  });
}

/* ================= Bulletins de paie — périodes ========================= */

export interface PeriodePaie {
  id: string;
  nom: string;
  periode_debut: string;
  periode_fin: string;
  statut: string;
  /** Vide = période COLLECTIVE (tous les enseignants). */
  enseignants: Array<{ id: string; nom: string }>;
  nb_paiements: number;
  /** `false` tant qu'aucun calcul n'a tourné : c'est ce qui bloque la suivante. */
  utilisee: boolean;
  cree_le: string;
}

export function usePeriodesPaie() {
  return useQuery<{ items: PeriodePaie[] }>({
    queryKey: ["prof-remuneration", "bulletins", "periodes"],
    queryFn: () => apiFetch(`${BASE}/bulletins/periodes`),
    staleTime: 15_000,
  });
}

/**
 * Période en attente de calcul, s'il en existe une. L'écran s'en sert pour
 * désactiver son formulaire AVANT saisie, plutôt que de laisser l'utilisateur
 * tout remplir pour se voir opposer un refus.
 */
export function usePeriodeEnAttente() {
  return useQuery<{ periode: PeriodePaie | null }>({
    queryKey: ["prof-remuneration", "bulletins", "periode-en-attente"],
    queryFn: () => apiFetch(`${BASE}/bulletins/periode-en-attente`),
    staleTime: 15_000,
  });
}

export interface CreerPeriodeInput {
  name: string;
  periodStart?: string;
  periodEnd?: string;
  /** Vide ou absent = période collective (tous les enseignants). */
  teacherIds?: string[];
}

/** Création d'une période. Les périodes vivent sous `/payment-periods`. */
export function useCreerPeriodePaie() {
  const qc = useQueryClient();
  return useMutation<any, Error, CreerPeriodeInput>({
    mutationFn: async (payload) => {
      const res = await fetch("/api/v1/payment-periods", {
        method: "POST",
        headers: { ...createApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // Le 409 du verrou porte un message explicite : le remonter tel quel
        // vaut mieux qu'un « erreur 409 » qui n'apprend rien.
        throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
      }
      return json?.data ?? json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prof-remuneration", "bulletins"] });
      qc.invalidateQueries({ queryKey: ["payment-periods"] });
    },
  });
}

/* ================= Bulletins de paie — génération ======================= */

export interface BulletinCourant {
  id: string;
  statut: string;
  montant: number;
  devise: string;
  calcule_le: string | null;
  periode_id: string;
  periode_nom: string;
}

export interface BulletinArchive {
  id: string;
  statut: string;
  montant: number;
  devise: string;
  calcule_le: string | null;
  archive_le: string;
  /** Date du versement réel. `null` tant que le bulletin est « Impayé ». */
  verse_le: string | null;
  type_paiement: string;
  heures_normales: number | null;
  heures_sup: number | null;
  enseignant_id: string;
  enseignant_nom: string | null;
  /** Sert de clé au filtre par période : deux périodes peuvent porter le même nom. */
  periode_id: string;
  periode_nom: string;
  periode_debut: string;
  periode_fin: string;
  /** Année scolaire de la période (null si la période n'y est pas rattachée). */
  annee_scolaire: string | null;
  archive_par: string;
  nb_lignes: number;
}

/** Lance le calcul d'une période. Le périmètre est appliqué côté serveur. */
export function useCalculerPeriode() {
  const qc = useQueryClient();
  return useMutation<
    { calculated: number; skipped: number; errors: number },
    Error,
    { periodId: string }
  >({
    mutationFn: async ({ periodId }) => {
      const res = await fetch("/api/v1/teacher-payments/calculate", {
        method: "POST",
        headers: { ...createApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, recalculate: true, scope: "all" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
      return json?.data ?? json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration", "bulletins"] }),
  });
}

/**
 * Classe des bulletins ET ARRÊTE leur montant : ils quittent le plan de travail
 * pour l'historique, au statut « Impayé » — dû, pas encore versé.
 */
export function useArchiverBulletins() {
  const qc = useQueryClient();
  /* `tous: true` plutôt qu'une liste d'identifiants : la vue d'ensemble ne
     remonte qu'UN bulletin par enseignant, donc l'écran ne connaît jamais la
     liste complète. Lui faire énumérer les ids n'archivait que ce qu'il
     affichait et laissait le reste au plan de travail. */
  return useMutation<{ archives: number; deja_archives: number; a_verser: number }, Error, void>({
    mutationFn: () => apiFetch(`${BASE}/bulletins/archiver`, jsonInit("POST", { tous: true })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration", "bulletins"] }),
  });
}

/**
 * Constate le VERSEMENT de bulletins arrêtés — c'est ce geste, et lui seul, qui
 * fait passer un bulletin d'« Impayé » à « Payé » et enregistre sa date.
 *
 * Accepte une liste ; sans argument, verse tout ce qui est arrêté et non encore
 * versé. Le serveur n'agit que sur les bulletins `approved`.
 */
export function useMarquerVerses() {
  const qc = useQueryClient();
  return useMutation<{ verses: number; ignores: number }, Error, string[] | undefined>({
    mutationFn: (paymentIds) =>
      apiFetch(
        `${BASE}/bulletins/verser`,
        jsonInit("POST", paymentIds?.length ? { paymentIds } : { tous: true })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prof-remuneration", "bulletins"] }),
  });
}

/** Historique des bulletins archivés, le plus récent en premier. */
export function useHistoriqueBulletins(enseignantId?: string) {
  return useQuery<{ items: BulletinArchive[]; total: number }>({
    queryKey: ["prof-remuneration", "bulletins", "historique", enseignantId ?? "tous"],
    queryFn: () =>
      apiFetch(
        `${BASE}/bulletins/historique${enseignantId ? `?enseignantId=${enseignantId}` : ""}`
      ),
    staleTime: 15_000,
  });
}
