const BASE_URL = process.env.PAYHUBSECURE_BASE_URL || "";
const API_KEY = process.env.PAYHUBSECURE_API_KEY || "";
const MERCHANT_ID = process.env.PAYHUBSECURE_MERCHANT_ID || "";

export interface PaymentRequest {
  code_paiement: string;
  nom_usager: string;
  prenom_usager: string;
  telephone?: string;
  email?: string;
  libelle_article: string;
  quantite: number;
  montant: string;
  lib_order: string;
  Url_Retour: string;
  Url_Callback: string;
}

export interface PaymentResponse {
  tokens: string;
  url: string;
  code: number;
  message: string;
}

export interface IPNPayload {
  codePaiement: string;
  referencePaiement: string;
  montant: number;
  moyenPaiement: string;
  numTel: string;
  datePaiement: string;
  HeurePaiement: string;
  code: number;
  cleretour: string;
}

export async function initierPaiement(
  data: PaymentRequest
): Promise<PaymentResponse> {
  if (!BASE_URL || !API_KEY || !MERCHANT_ID) {
    return {
      tokens: "mock-token",
      url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/paiement/retour?code=${data.code_paiement}&mock=1`,
      code: 200,
      message: "Mock payment session created",
    };
  }

  const response = await fetch(`${BASE_URL}/api/payhub-ws/build-away`, {
    method: "POST",
    headers: {
      ApiKey: API_KEY,
      MerchantId: MERCHANT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`PayHubSecure error: ${response.status}`);
  }

  return response.json();
}
