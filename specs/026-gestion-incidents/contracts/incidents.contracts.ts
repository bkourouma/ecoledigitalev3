/**
 * RSO-PFSO Incident Contracts
 * Shared TypeScript types for incident management endpoints
 */

export type IncidentType =
  | 'intrusion'
  | 'vol'
  | 'vandalisme'
  | 'incendie'
  | 'accident'
  | 'acces_non_autorise'
  | 'falsification_documents'
  | 'equipement_defectueux'
  | 'violation_procedure'
  | 'cyber_incident'
  | 'autre';

export type IncidentCategorie = 'mineur' | 'modere' | 'grave' | 'critique';

export type IncidentUrgence = 'bas' | 'moyen' | 'eleve' | 'critique';

export type IncidentStatut =
  | 'nouveau'
  | 'en_investigation'
  | 'en_traitement'
  | 'resolu'
  | 'clos'
  | 'archive';

export type IncidentPriorite = 'P1' | 'P2' | 'P3' | 'P4';

export type IncidentConfidentialite = 'public' | 'restreint' | 'confidentiel' | 'secret';

export type MediaType = 'image' | 'video' | 'audio' | 'document';

export type CommentaireType = 'general' | 'investigation' | 'mesure' | 'interne';

export type MesureType = 'immediate' | 'corrective' | 'preventive';

export type MesureStatut = 'planifiee' | 'en_cours' | 'terminee' | 'annulee';

export type MesureEfficacite = 'faible' | 'moyenne' | 'bonne' | 'excellente';

export type HistoriqueAction =
  | 'creation'
  | 'modification'
  | 'changement_statut'
  | 'assignation'
  | 'ajout_media'
  | 'ajout_commentaire'
  | 'mesure_prise'
  | 'validation'
  | 'cloture';

// Person entities
export interface Temoin {
  nom: string;
  fonction?: string;
  telephone?: string;
  email?: string;
}

export interface Suspect {
  description: string;
  identite?: string;
  identifie: boolean;
}

export interface Victime {
  nom: string;
  blessures?: string;
  telephone?: string;
  email?: string;
}

// Media entity
export interface IncidentMedia {
  id: number;
  typeMedia: MediaType;
  nomFichier: string;
  nomOriginal: string;
  cheminFichier: string;
  cheminThumbnail?: string | null;
  tailleOctets: number;
  mimeType: string;
  description?: string | null;
  estPreuve: boolean;
  ordre: number;
  uploadedBy: {
    id: number;
    nom: string;
    prenoms: string;
  };
  uploadedAt: string;
}

// Comment entity
export interface IncidentCommentaire {
  id: number;
  commentaire: string;
  typeCommentaire: CommentaireType;
  visibleAgentsSurete: boolean;
  user: {
    id: number;
    nom: string;
    prenoms: string;
  };
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// Measure entity
export interface IncidentMesure {
  id: number;
  typeMesure: MesureType;
  description: string;
  responsable?: {
    id: number;
    nom: string;
    prenoms: string;
  } | null;
  dateEcheance?: string | null;
  statut: MesureStatut;
  dateRealisation?: string | null;
  coutEstime?: number | null;
  coutReel?: number | null;
  efficacite?: MesureEfficacite | null;
  commentaireEfficacite?: string | null;
  createdBy: {
    id: number;
    nom: string;
    prenoms: string;
  };
  createdAt: string;
  updatedAt: string;
}

// History entity
export interface IncidentHistorique {
  id: number;
  action: HistoriqueAction;
  ancienStatut?: string | null;
  nouveauStatut?: string | null;
  commentaire?: string | null;
  donneesModifiees?: Record<string, unknown> | null;
  user: {
    id: number;
    nom: string;
    prenoms: string;
  };
  createdAt: string;
}

// Main incident entity
export interface Incident {
  id: number;
  codeIncident: string;
  titre: string;
  installation: {
    id: number;
    nomPort: string;
    codeInstallation: string;
  };
  annee: {
    id: number;
    annee: number;
  };
  typeIncident: IncidentType;
  categorie: IncidentCategorie;
  niveauUrgence: IncidentUrgence;
  zoneIncident: string;
  dateIncident: string;
  dateDecouverte?: string | null;
  descriptionCourte: string;
  descriptionDetaillee: string;
  circonstances?: string | null;
  temoins?: Temoin[] | null;
  suspects?: Suspect[] | null;
  victimes?: Victime[] | null;
  impactMateriel?: string | null;
  impactOperationnel?: string | null;
  impactHumain?: string | null;
  coutEstime?: number | null;
  statut: IncidentStatut;
  priorite: IncidentPriorite;
  declarePar: {
    id: number;
    nom: string;
    prenoms: string;
    email: string;
  };
  assigneA?: {
    id: number;
    nom: string;
    prenoms: string;
    email: string;
  } | null;
  validePar?: {
    id: number;
    nom: string;
    prenoms: string;
  } | null;
  datePriseEnCharge?: string | null;
  dateResolution?: string | null;
  dateValidation?: string | null;
  dateCloture?: string | null;
  mesuresImmediates?: string | null;
  mesuresCorrectives?: string | null;
  mesuresPreventives?: string | null;
  conformeIsps: boolean;
  raisonNonConformite?: string | null;
  niveauConfidentialite: IncidentConfidentialite;
  tags?: string[] | null;
  donneesSupplementaires?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// Request types
export interface CreateIncidentRequest {
  installationId: number;
  anneeId: number;
  typeIncident: IncidentType;
  zoneIncident: string;
  dateIncident: string;
  dateDecouverte?: string;
  descriptionCourte: string;
  descriptionDetaillee: string;
  circonstances?: string;
  niveauUrgence: IncidentUrgence;
  categorie?: IncidentCategorie;
  priorite?: IncidentPriorite;
  temoins?: Temoin[];
  suspects?: Suspect[];
  victimes?: Victime[];
  impactMateriel?: string;
  impactOperationnel?: string;
  impactHumain?: string;
  coutEstime?: number;
  niveauConfidentialite?: IncidentConfidentialite;
  tags?: string[];
  donneesSupplementaires?: Record<string, unknown>;
}

export interface UpdateIncidentRequest {
  titre?: string;
  typeIncident?: IncidentType;
  zoneIncident?: string;
  dateIncident?: string;
  dateDecouverte?: string;
  descriptionCourte?: string;
  descriptionDetaillee?: string;
  circonstances?: string;
  niveauUrgence?: IncidentUrgence;
  categorie?: IncidentCategorie;
  priorite?: IncidentPriorite;
  temoins?: Temoin[];
  suspects?: Suspect[];
  victimes?: Victime[];
  impactMateriel?: string;
  impactOperationnel?: string;
  impactHumain?: string;
  coutEstime?: number;
  mesuresImmediates?: string;
  mesuresCorrectives?: string;
  mesuresPreventives?: string;
  conformeIsps?: boolean;
  raisonNonConformite?: string;
  niveauConfidentialite?: IncidentConfidentialite;
  tags?: string[];
  donneesSupplementaires?: Record<string, unknown>;
}

export interface ChangeIncidentStatusRequest {
  nouveauStatut: IncidentStatut;
  commentaire?: string;
}

export interface AssignIncidentRequest {
  responsableId: number;
  commentaire?: string;
}

export interface IncidentListResponse {
  incidents: Incident[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IncidentDetailResponse extends Incident {
  medias: IncidentMedia[];
  commentaires: IncidentCommentaire[];
  mesures: IncidentMesure[];
  historique: IncidentHistorique[];
}

export interface IncidentFilters {
  statut?: IncidentStatut[];
  typeIncident?: IncidentType[];
  niveauUrgence?: IncidentUrgence[];
  categorie?: IncidentCategorie[];
  installationId?: number[];
  assigneA?: number[];
  declarePar?: number[];
  priorite?: IncidentPriorite[];
  dateDebut?: string;
  dateFin?: string;
  anneeId?: number;
  search?: string; // Full-text search
}

export interface IncidentSearchRequest {
  filters?: IncidentFilters;
  page?: number;
  limit?: number;
  sortBy?: 'dateIncident' | 'niveauUrgence' | 'priorite' | 'statut';
  sortOrder?: 'asc' | 'desc';
}

// Dashboard types
export interface IncidentDashboardStats {
  total: number;
  nouveaux: number;
  enCours: number;
  resolus: number;
  clos: number;
  critiques: number;
  graves: number;
  moderes: number;
  mineurs: number;
}

export interface IncidentEvolutionData {
  mois: string; // Format: "2024-01"
  total: number;
  critiques: number;
  resolus: number;
}

export interface IncidentTypeDistribution {
  type: IncidentType;
  count: number;
  percentage: number;
}

export interface IncidentResolutionTime {
  categorie: IncidentCategorie;
  tempsMoyenHeures: number;
  objectifHeures: number;
  objectifAtteint: boolean;
}

export interface IncidentDashboardResponse {
  stats: IncidentDashboardStats;
  evolution: IncidentEvolutionData[];
  distributionParType: IncidentTypeDistribution[];
  tempsMoyenResolution: IncidentResolutionTime[];
  incidentsUrgents: Incident[];
  parInstallation: Array<{
    installation: {
      id: number;
      nomPort: string;
    };
    total: number;
    critiques: number;
    resolus: number;
  }>;
}

// Statistics types
export interface IncidentStatisticsResponse {
  periode: {
    dateDebut: string;
    dateFin: string;
  };
  stats: IncidentDashboardStats;
  evolution: IncidentEvolutionData[];
  distributionParType: IncidentTypeDistribution[];
  tempsMoyenResolution: IncidentResolutionTime[];
  parInstallation: Array<{
    installation: {
      id: number;
      nomPort: string;
    };
    total: number;
    critiques: number;
    resolus: number;
  }>;
}

// Media upload types
export interface UploadMediaRequest {
  description?: string;
  estPreuve?: boolean;
  ordre?: number;
}

export interface UploadMediaResponse {
  media: IncidentMedia;
  message: string;
}

// Comment types
export interface CreateCommentaireRequest {
  commentaire: string;
  typeCommentaire?: CommentaireType;
  visibleAgentsSurete?: boolean;
}

export interface UpdateCommentaireRequest {
  commentaire: string;
  typeCommentaire?: CommentaireType;
  visibleAgentsSurete?: boolean;
}

// Measure types
export interface CreateMesureRequest {
  typeMesure: MesureType;
  description: string;
  responsableId?: number;
  dateEcheance?: string;
  coutEstime?: number;
}

export interface UpdateMesureRequest {
  description?: string;
  responsableId?: number;
  dateEcheance?: string;
  statut?: MesureStatut;
  dateRealisation?: string;
  coutEstime?: number;
  coutReel?: number;
  efficacite?: MesureEfficacite;
  commentaireEfficacite?: string;
}

export interface ChangeMesureStatusRequest {
  statut: MesureStatut;
  dateRealisation?: string;
  commentaire?: string;
}

// Export types
export interface ExportIncidentsRequest {
  filters?: IncidentFilters;
  format: 'excel' | 'pdf';
}

export interface ExportIncidentsResponse {
  jobId: string;
  message: string;
  estimatedTime?: number; // seconds
}

// Notification types
export interface NotifyIncidentRequest {
  userIds: number[];
  message?: string;
  priorite?: 'normale' | 'haute' | 'urgente';
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

