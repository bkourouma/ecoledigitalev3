/**
 * RSO-PFSO Media Management Contracts
 * Shared TypeScript types for media and document management endpoints
 */

export type MediaType = 'image' | 'video' | 'document' | 'audio';

export type MediaProcessingStatus = 'en_cours' | 'traite' | 'erreur';

export type ExportType = 'pdf' | 'word' | 'excel' | 'csv';

export type ExportStatus = 'en_cours' | 'termine' | 'erreur';

export type PageFormat = 'A4' | 'Letter' | 'Legal' | 'A3';

export type Orientation = 'portrait' | 'landscape';

export interface RSOUser {
  id: number;
  nom: string;
  prenoms: string;
  email?: string;
}

export interface RSOActivity {
  id: number;
  codeActivite: string;
  titre: string;
}

export interface RSOMedia {
  id: number;
  activiteId?: number | null;
  typeMedia: MediaType;
  nomOriginal: string;
  nomFichier: string;
  cheminFichier: string;
  cheminThumbnail?: string | null;
  cheminOptimise?: string | null;
  tailleOctets: number;
  tailleHumaine: string;
  mimeType: string;
  extension: string;
  largeur?: number | null;
  hauteur?: number | null;
  dureeSecondes?: number | null;
  legende?: string | null;
  description?: string | null;
  ordre: number;
  estPrincipal: boolean;
  statut: MediaProcessingStatus;
  erreurMessage?: string | null;
  exifData?: Record<string, any> | null;
  urlOriginal: string;
  urlOptimise?: string | null;
  urlThumbnail?: string | null;
  activite?: RSOActivity | null;
  uploadedBy: RSOUser;
  uploadedAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
  deletedAt?: string | null; // ISO datetime string
}

export interface RSOMediaUploadRequest {
  files: File[];
  activiteId?: number;
  legende?: string;
}

export interface RSOMediaUploadResponse {
  medias: RSOMedia[];
  quota: RSOQuotaInfo;
}

export interface RSOMediaListQuery {
  page?: number;
  limit?: number;
  typeMedia?: MediaType;
  activiteId?: number;
  dateDebut?: string; // ISO date string
  dateFin?: string; // ISO date string
  search?: string;
  view?: 'grid' | 'list';
}

export interface RSOMediaListResponse {
  medias: RSOMedia[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  quota: RSOQuotaInfo;
}

export interface RSOMediaUpdateRequest {
  legende?: string;
  description?: string;
  ordre?: number;
}

export interface RSOMediaOrderRequest {
  ordre: number;
}

export interface RSOMediaAssociateRequest {
  mediaIds: number[];
  ordre?: number[];
}

export interface RSOQuotaInfo {
  quotaTotalMo: number;
  quotaUtiliseMo: number;
  quotaUtilisePourcent: number;
  quotaRestantMo?: number;
  repartition?: {
    images: {
      tailleMo: number;
      nbFichiers: number;
      pourcent?: number;
    };
    videos: {
      tailleMo: number;
      nbFichiers: number;
      pourcent?: number;
    };
    documents: {
      tailleMo: number;
      nbFichiers: number;
      pourcent?: number;
    };
  };
  limites?: {
    fichierImageMo: number;
    fichierVideoMo: number;
    fichierDocumentMo: number;
  };
  avertissement?: string | null;
}

export interface RSOQuotaStats {
  totalFichiers: number;
  totalTailleMo: number;
  repartitionParType: {
    images: { nb: number; tailleMo: number };
    videos: { nb: number; tailleMo: number };
    documents: { nb: number; tailleMo: number };
  };
  evolution: Array<{
    mois: string; // YYYY-MM
    tailleMo: number;
  }>;
  activitesPlusConsommatrices: Array<{
    activiteId: number;
    codeActivite: string;
    tailleMo: number;
    nbFichiers: number;
  }>;
}

export interface RSOExportOptions {
  formatPage?: PageFormat;
  orientation?: Orientation;
  includeImages?: boolean;
  includeRecommendations?: boolean;
  watermark?: boolean;
}

export interface RSOPDFExportRequest extends RSOExportOptions {
  formatPage?: PageFormat;
  orientation?: Orientation;
  includeImages?: boolean;
  includeRecommendations?: boolean;
  watermark?: boolean;
}

export interface RSOWordExportRequest {
  includeImages?: boolean;
  includeRecommendations?: boolean;
}

export interface RSOExcelExportRequest {
  filters?: {
    installationId?: number;
    typeActivite?: string;
    anneeId?: number;
    statut?: string;
    dateDebut?: string;
    dateFin?: string;
  };
}

export interface RSODocumentExport {
  id: number;
  activiteId?: number | null;
  userId: number;
  typeExport: ExportType;
  nomFichier: string;
  cheminFichier: string;
  tailleOctets: number;
  formatPage?: PageFormat | null;
  orientation?: Orientation | null;
  optionsExport?: Record<string, any> | null;
  statut: ExportStatus;
  erreurMessage?: string | null;
  expireAt?: string | null; // ISO datetime string
  nbTelechargements: number;
  dernierTelechargement?: string | null; // ISO datetime string
  createdAt: string; // ISO datetime string
}

export interface RSOQuota {
  id: number;
  userId: number;
  user?: RSOUser;
  quotaTotalMo: number;
  quotaUtiliseMo: number;
  limiteFichierImageMo: number;
  limiteFichierVideoMo: number;
  limiteFichierDocumentMo: number;
  nbTotalFichiers: number;
  nbImages: number;
  nbVideos: number;
  nbDocuments: number;
  dernierUpload?: string | null; // ISO datetime string
  dernierNettoyage?: string | null; // ISO datetime string
  updatedAt: string; // ISO datetime string
}

export interface RSOQuotaUpdateRequest {
  quotaTotalMo: number;
}

export interface RSOQuotaListResponse {
  quotas: RSOQuota[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RSOMediaGallery {
  activiteId: number;
  medias: RSOMedia[];
  imagePrincipale?: {
    id: number;
    urlThumbnail: string;
  } | null;
}

export interface RSOMediaPrimaryResponse {
  message: string;
  mediaPrincipal: {
    id: number;
    nomOriginal: string;
    urlThumbnail: string;
  };
}

export interface RSOErrorResponse {
  error: string;
  message: string;
  details?: {
    field?: string;
    reason?: string;
  };
  maxSize?: string;
  quotaTotalMo?: number;
  quotaUtiliseMo?: number;
  requiredMo?: number;
}

