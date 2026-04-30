export const TENANT_ASPCI_ID = "52da6ca7-81ad-47ad-b5c3-6f437f64ba37" as const;

/** ASPCI : sessions / calendrier. Imhotep Data et autres : inscription sur la formation (sans sessions). */
export function usesSessionBasedProfessionalCatalogue(tenantId: string | undefined): boolean {
  return tenantId === TENANT_ASPCI_ID;
}
