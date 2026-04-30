export interface PaymentRequestPayload {
  formationId: string;
  sessionId?: string | null;
  telephone?: string;
}

export interface PaymentInitResponse {
  url: string;
  codePaiement: string;
}
