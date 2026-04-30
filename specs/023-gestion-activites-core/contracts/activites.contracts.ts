/**
 * RSO-PFSO Activity Contracts
 * Shared TypeScript types for activity management endpoints
 */

export type ActivityStatus = 
  | 'brouillon'
  | 'en_cours'
  | 'termine'
  | 'valide'
  | 'archive';

export type ActivityTypeCode = 
  | 'CARTOGRAPHIE'
  | 'ENTRAINEMENT'
  | 'ENTRAINEMENT_T1'
  | 'ENTRAINEMENT_T2'
  | 'ENTRAINEMENT_T3'
  | 'ENTRAINEMENT_T4'
  | 'EXERCICE_ANNUEL'
  | 'EXERCICE_SEMINAIRE'
  | 'EXERCICE_SUR_TABLE'
  | 'EXERCICE_GRANDEUR_NATURE'
  | 'FORMATION_SURETE'
  | 'AUDIT_SURETE'
  | 'AUDIT_SEMESTRE_1'
  | 'AUDIT_SEMESTRE_2'
  | 'EVALUATION_SURETE';

export type VideoPlatform = 
  | 'zoom'
  | 'teams'
  | 'meet'
  | 'autre';

export type RecommendationPriority = 
  | 'basse'
  | 'moyenne'
  | 'haute'
  | 'critique';

export type RecommendationStatus = 
  | 'en_attente'
  | 'en_cours'
  | 'terminee'
  | 'validee'
  | 'annulee';

export type SearchSort = 
  | 'pertinence'
  | 'date_desc'
  | 'date_asc'
  | 'titre_asc';

export interface RSOUser {
  id: number;
  nom: string;
  prenoms: string;
}

export interface RSOInstallation {
  id: number;
  nomPort: string;
  codeInstallation: string;
}

export interface RSOAnnee {
  id: number;
  annee: number;
}

export interface RSOActivityType {
  id: number;
  code: ActivityTypeCode;
  libelle: string;
  description?: string | null;
  parentId?: number | null;
  ordre: number;
  icone?: string | null;
  couleur?: string | null;
  actif: boolean;
  sousTypes?: RSOActivityType[];
}

export interface RSOActivity {
  id: number;
  codeActivite: string;
  titre: string;
  annee?: RSOAnnee;
  anneeId: number;
  installation: RSOInstallation;
  installationId: number;
  typeActivite: ActivityTypeCode;
  sousType?: string | null;
  contenuHtml?: string;
  dateActivite: string; // ISO date string
  dureeMinutes?: number | null;
  lieu?: string | null;
  nombreParticipants?: number | null;
  plateformeVisio?: VideoPlatform | null;
  lienVisio?: string | null;
  statut: ActivityStatus;
  dateValidation?: string | null; // ISO datetime string
  validePar?: RSOUser | null;
  visibleTousPfso: boolean;
  pfsoAgents?: RSOActivityPermission[];
  recommandations?: RSORecommendation[];
  createdBy: RSOUser;
  createdAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
  updatedBy?: RSOUser | null;
  deletedAt?: string | null; // ISO datetime string
}

export interface RSOActivityPermission {
  id: number;
  activiteId: number;
  user: RSOUser;
  userId: number;
  grantedBy: RSOUser;
  grantedAt: string; // ISO datetime string
}

export interface RSORecommendation {
  id: number;
  activiteId: number;
  titre: string;
  description: string;
  priorite: RecommendationPriority;
  statut: RecommendationStatus;
  dateEcheance?: string | null; // ISO date string
  responsable?: RSOUser | null;
  responsableId?: number | null;
  dateResolution?: string | null; // ISO date string
  actionsPrises?: string | null;
  resoluPar?: RSOUser | null;
  createdBy: RSOUser;
  createdAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
}

export interface CreateActivityRequest {
  installationId: number;
  typeActivite: ActivityTypeCode;
  sousType?: string | null;
  titre: string;
  dateActivite: string; // ISO date string
  dureeMinutes?: number | null;
  lieu?: string | null;
  nombreParticipants?: number | null;
  plateformeVisio?: VideoPlatform | null;
  lienVisio?: string | null;
  visibleTousPfso?: boolean;
  pfsoAgentsIds?: number[];
}

export interface UpdateActivityRequest {
  titre?: string;
  dateActivite?: string; // ISO date string
  dureeMinutes?: number | null;
  lieu?: string | null;
  nombreParticipants?: number | null;
  plateformeVisio?: VideoPlatform | null;
  lienVisio?: string | null;
  statut?: ActivityStatus;
}

export interface UpdateActivityContentRequest {
  contenuHtml: string;
}

export interface UpdateActivityDraftRequest {
  contenuHtml: string;
}

export interface UpdateActivityStatusRequest {
  statut: ActivityStatus;
}

export interface UpdateActivityPermissionsRequest {
  visibleTousPfso: boolean;
  pfsoAgentsIds: number[];
}

export interface ActivityListResponse {
  activites: RSOActivity[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateRecommendationRequest {
  titre: string;
  description: string;
  priorite: RecommendationPriority;
  responsableId?: number | null;
  dateEcheance?: string | null; // ISO date string
}

export interface UpdateRecommendationRequest {
  titre?: string;
  description?: string;
  priorite?: RecommendationPriority;
  responsableId?: number | null;
  dateEcheance?: string | null; // ISO date string
}

export interface UpdateRecommendationStatusRequest {
  statut: RecommendationStatus;
  actionsPrises?: string | null;
  dateResolution?: string | null; // ISO date string
}

export interface RecommendationListResponse {
  recommandations: RSORecommendation[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RecommendationStats {
  total: number;
  enAttente: number;
  enCours: number;
  terminees: number;
  validees: number;
  enRetard: number;
}

export interface ActivitySearchRequest {
  q: string;
  anneeId?: number;
  installationId?: number;
  typeActivite?: ActivityTypeCode;
  statut?: ActivityStatus;
  dateDebut?: string; // ISO date string
  dateFin?: string; // ISO date string
  tri?: SearchSort;
  page?: number;
  limit?: number;
}

export interface ActivitySearchResult {
  id: number;
  codeActivite: string;
  titre: string;
  extrait: string; // Content excerpt with highlighted search terms
  installation: RSOInstallation;
  typeActivite: ActivityTypeCode;
  dateActivite: string; // ISO date string
  pertinence: number; // Relevance score (0-1)
}

export interface ActivitySearchResponse {
  resultats: ActivitySearchResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ActivityTypeListResponse {
  types: RSOActivityType[];
}

export interface ImageUploadResponse {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface ApiError {
  error: string;
  message: string;
  code: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

