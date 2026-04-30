/**
 * RSO-PFSO Year Management Contracts
 * Shared TypeScript types for year management endpoints
 */

export type YearStatus = 'active' | 'archive';

export interface RSOAnnee {
  id: number;
  annee: number;
  statut: YearStatus;
  createdAt: string;
}

export interface YearListResponse {
  annees: RSOAnnee[];
  activeYear: number;
}

export interface CreateAnneeRequest {
  annee: number;
  statut?: YearStatus;
}

export interface UpdateAnneeRequest {
  statut: YearStatus;
}

export interface YearSelectorState {
  selectedYear: number;
  availableYears: number[];
  activeYear: number;
}

