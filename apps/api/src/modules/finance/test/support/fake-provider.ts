/**
 * Faux fournisseur « réel » pour les tests : prouve que le port `PaymentProvider` permet de
 * brancher un adaptateur (Orange, MTN, Wave, CinetPay, TresorPay…) sans toucher au module.
 * Il n'est PAS simulé (`simulated = false`) : ses paiements sont de vrais paiements.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { err, ok, Money, type AppError, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, validation } from "../../domain/errors";
import type {
  PaymentProvider,
  ProviderHeaders,
  ProviderInitiateRequest,
  ProviderInitiation,
  ProviderPaymentStatus,
  ProviderVerification,
  ProviderVerifyRequest,
  ProviderWebhookEvent,
} from "../../application/ports/payment-provider";
import type { ProviderDefinition } from "../../infrastructure/providers/registry";

export class FakeRealProvider implements PaymentProvider {
  readonly simulated = false;
  initiations: ProviderInitiateRequest[] = [];
  failNextInitiate = false;
  /** Statut que `verify` renverra. */
  verifyStatus: ProviderPaymentStatus = "PENDING";
  verifyAmount: Money | null = null;
  /** Références interrogées par `verify` (preuve de QUEL compte a été interrogé : voir `apiKey` / `tenantId`). */
  verifyCalls: Array<string | null> = [];

  constructor(
    private readonly name: string,
    private readonly secret: string,
    /** Clé d'API du compte (distingue le compte d'une école du compte de la plateforme). */
    readonly apiKey: string = "",
    readonly tenantId: string = "",
  ) {}

  getProviderName(): string {
    return this.name;
  }

  async initiate(request: ProviderInitiateRequest): Promise<Result<ProviderInitiation, AppError>> {
    if (this.failNextInitiate) {
      this.failNextInitiate = false;
      return err(conflict(FinanceCode.PROVIDER_FAILED, "réseau indisponible", {}));
    }
    this.initiations.push(request);
    return ok({ providerRef: `${this.name}-${request.paymentId.slice(-8)}`, status: "PENDING", ussdCode: "*144#", instructions: "Composez *144#" });
  }

  async verify(request: ProviderVerifyRequest): Promise<Result<ProviderVerification, AppError>> {
    this.verifyCalls.push(request.providerRef);
    return ok({
      status: this.verifyStatus,
      providerRef: request.providerRef,
      amount: this.verifyAmount,
      paidAt: this.verifyStatus === "SUCCEEDED" ? new Date() : null,
    });
  }

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody, "utf8").digest("hex");
  }

  verifySignature(rawBody: string, headers: ProviderHeaders): boolean {
    const h = headers["x-fake-signature"];
    const given = Array.isArray(h) ? h[0] : h;
    if (!this.secret || typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) return false;
    const a = Buffer.from(this.sign(rawBody), "hex");
    const b = Buffer.from(given, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handleWebhook(rawBody: string): Promise<Result<ProviderWebhookEvent, AppError>> {
    try {
      const o = JSON.parse(rawBody) as { event: string; kind: string; order: string; ref: string; amount?: number; ok?: boolean };
      return ok({
        eventId: o.event,
        type: o.kind,
        paymentId: o.order ?? null,
        providerRef: o.ref ?? null,
        status: o.ok ? "SUCCEEDED" : "FAILED",
        amount: typeof o.amount === "number" ? Money.of(o.amount, "XOF") : null,
        occurredAt: null,
      });
    } catch {
      return err(validation(FinanceCode.WEBHOOK_PAYLOAD_INVALID, "illisible", "body"));
    }
  }
}

export const fakeDefinition = (name: string, instances: FakeRealProvider[] = []): ProviderDefinition => ({
  name,
  requiredSettings: ["apiKey", "webhookSecret"],
  create: ({ settings, tenantId }) => {
    const p = new FakeRealProvider(name, settings.webhookSecret ?? "", settings.apiKey ?? "", tenantId);
    instances.push(p);
    return p;
  },
});
