/**
 * Port `SecretStorePort` : coffre des secrets marchands (clés d'API, secrets de webhook).
 *
 * Contrat : un secret est SCELLÉ avant d'atteindre la base (enveloppe opaque) et n'est rouvert qu'au moment de son
 * usage. Le sceau est lié à son contexte (`tenant | fournisseur | champ`) : une enveloppe copiée vers un autre tenant
 * ou un autre champ ne s'ouvre pas. Aucune méthode ne renvoie ni ne journalise un clair hors de `open`.
 *
 * Adaptateur fourni : `AesGcmSecretStore` (AES-256-GCM, trousseau de clés d'environnement, rotation). Un KMS peut le
 * remplacer sans toucher au reste du module.
 */
export interface SecretScope {
  readonly tenantId: string;
  readonly provider: string;
  readonly field: string;
}

export type SecretStoreFailure = "unavailable" | "malformed" | "unknown_key" | "tampered";

/** Erreur du coffre : ne porte JAMAIS de clair ni de matériau de clé, seulement un motif court. */
export class SecretStoreError extends Error {
  constructor(readonly reason: SecretStoreFailure) {
    super(`Coffre des secrets : ${reason}.`);
    this.name = "SecretStoreError";
  }
}

export interface SecretStorePort {
  /** Une clé maître est configurée : sans elle, ni scellement ni ouverture. */
  readonly available: boolean;
  /** Identifiant de la clé qui scelle les nouveaux secrets (`null` si indisponible). */
  readonly activeKeyId: string | null;
  seal(scope: SecretScope, plaintext: string): Promise<string>;
  open(scope: SecretScope, envelope: string): Promise<string>;
  /** Vrai si l'enveloppe est scellée avec la clé active (sinon : à rechiffrer). */
  isCurrent(envelope: string): boolean;
}
