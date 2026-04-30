export interface PublicUserProfile {
  id: string;
  email: string;
  nom?: string | null;
  prenom?: string | null;
  telephone?: string | null;
  avatarUrl?: string | null;
}
