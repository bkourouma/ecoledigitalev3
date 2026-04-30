/**
 * RSO-PFSO Installation Contracts
 * Shared TypeScript types for installation management endpoints
 */

export type InstallationType = 
  | 'port_commerce'
  | 'terminal_conteneurs'
  | 'terminal_petrolier'
  | 'terminal_mineranier'
  | 'autre';

export type InstallationStatus = 
  | 'actif'
  | 'inactif'
  | 'en_maintenance';

export type Ville = 'Abidjan' | 'San-Pedro';

export type TypeResponsable = 
  | 'pfso_principal'
  | 'pfso_adjoint'
  | 'rso_referent';

export interface RSOInstallation {
  id: number;
  nomPort: string;
  codeInstallation: string;
  typeInstallation: InstallationType;
  ville: Ville;
  statut: InstallationStatus;
  adresse?: string | null;
  contactNom?: string | null;
  contactTelephone?: string | null;
  contactEmail?: string | null;
  commentaire?: string | null;
  createdBy: {
    id: number;
    nom: string;
    prenoms: string;
  };
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateInstallationRequest {
  nomPort: string;
  codeInstallation: string;
  typeInstallation: InstallationType;
  ville: Ville;
  statut?: InstallationStatus;
  adresse?: string;
  contactNom?: string;
  contactTelephone?: string;
  contactEmail?: string;
  commentaire?: string;
}

export interface UpdateInstallationRequest {
  nomPort?: string;
  typeInstallation?: InstallationType;
  ville?: Ville;
  statut?: InstallationStatus;
  adresse?: string;
  contactNom?: string;
  contactTelephone?: string;
  contactEmail?: string;
  commentaire?: string;
}

export interface InstallationListResponse {
  installations: RSOInstallation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InstallationDetailResponse extends RSOInstallation {
  responsables: InstallationResponsable[];
  statistics?: InstallationStatistics;
}

export interface InstallationResponsable {
  id: number;
  user: {
    id: number;
    nom: string;
    prenoms: string;
    email?: string;
  };
  typeResponsable: TypeResponsable;
  dateDebut: string;
  dateFin?: string | null;
  statut: 'actif' | 'inactif';
}

export interface CreateResponsableRequest {
  userId: number;
  typeResponsable: TypeResponsable;
  dateDebut: string;
  dateFin?: string | null;
}

export interface UpdateResponsableRequest {
  typeResponsable?: TypeResponsable;
  dateDebut?: string;
  dateFin?: string | null;
}

export interface InstallationStatistics {
  installationId: number;
  year: number;
  totalActivities?: number;
  totalIncidents?: number;
  lastActivityDate?: string | null;
  activitiesByMonth?: Record<string, number>;
}

export interface GlobalInstallationStats {
  total: number;
  active: number;
  inactive: number;
  maintenance: number;
  byVille: Record<Ville, number>;
  byType: Record<InstallationType, number>;
}

export interface CheckCodeResponse {
  code: string;
  exists: boolean;
  available: boolean;
}

export interface InstallationFilters {
  page?: number;
  limit?: number;
  search?: string;
  ville?: Ville;
  type?: InstallationType;
  statut?: InstallationStatus;
  includeArchived?: boolean;
}

