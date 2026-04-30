export interface FormationCardData {
  id: string;
  slug: string;
  titre: string;
  descriptionCourte: string;
  prix: number;
  niveau: string;
  dureeHeures: number;
  dureeJours: number;
  mode: string;
  themes: string[];
  formateurNom: string;
  prochaineSession?: string | null;
  placesRestantes?: number | null;
}

export interface FormationSessionData {
  id: string;
  codeSession: string;
  dateDebut: string;
  dateFin: string;
  mode: string;
  lieu?: string | null;
  prix?: number | null;
  placesRestantes: number;
}

export interface FormationTrainerData {
  id: string;
  nomComplet: string;
  bio?: string | null;
  photoUrl?: string | null;
  specialites: string[];
}

export interface FormationModuleData {
  titre: string;
  points: string[];
}

export interface FormationDetailData extends FormationCardData {
  descriptionComplete: string;
  prerequis?: string | null;
  publicCible?: string | null;
  objectifs: string[];
  modules: FormationModuleData[];
  formateurs: FormationTrainerData[];
  sessions: FormationSessionData[];
  certification?: string | null;
  brochurePdfUrl?: string | null;
}

export interface CatalogueResponse {
  data: FormationCardData[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
