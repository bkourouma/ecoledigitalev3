/**
 * reportcards <-> higher : PDF, scellement et vérification publique des documents officiels (diplômes, attestations).
 *
 *   `DocumentFilesPort` (higher consomme reportcards) :
 *       seal    signature Ed25519 de l'empreinte du snapshot (`signDocumentHash`) + code inscrit dans l'index de vérification
 *               publique (`registerVerificationFor`), dans la transaction de higher ;
 *       render  gabarit de plateforme (`renderDocumentPdf`) -> PDF -> stockage d'objets -> empreinte du fichier indexée
 *               (`registerFileHashFor`) : un PDF téléversé sur la page publique est reconnu ;
 *       signedUrl  URL de lecture à durée courte du stockage.
 *   `ExternalDocumentVerifier` (reportcards consomme higher) : la lecture du document sous la RLS de son tenant ; reportcards
 *       revérifie l'empreinte recalculée et la signature, et répond SANS donnée personnelle.
 *
 * Le rendu exige un moteur PDF (Chromium) : il tourne dans le worker ; l'API n'enregistre que la demande. La clé de signature
 * (`REPORTCARDS_SIGNING_KEY[_FILE]`) et le domaine de vérification (`REPORTCARDS_VERIFICATION_BASE_URL` ou `V2_APP_BASE_URL`)
 * viennent de l'environnement ; sans clé, le scellement échoue explicitement (`reportcards.signing_key_missing`).
 */
import { err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import {
  createReportcardsDeps,
  ensureBuiltinTemplates,
  ensureSigningKeyRegistered,
  keyProviderFromEnv,
  puppeteerRendererFromEnv,
  registerFileHashFor,
  reportcardsWorkerOverrides,
  registerVerificationFor,
  renderDocumentPdf,
  signDocumentHash,
  type ExternalDocumentVerifier,
  type PdfRenderer,
  type ReportcardsDeps,
} from "../../modules/reportcards";
import { describeDocumentForVerification, type DocumentFilesPort, type HigherDeps } from "../../modules/higher";
import type { AdapterKit } from "./kit";
import type { ObjectStorage } from "./storage";

const portUnavailable = (what: string): AppError => new InternalError(`Le service « ${what} » n'est pas disponible : opération refusée.`, { code: "higher.port_unavailable", details: { port: what } });

/** Image du logo en data URI, reconnue par ses octets (PNG ou JPEG) ; `null` si absente ou illisible (le rendu continue sans logo). */
async function logoDataUri(storage: ObjectStorage | null, key: string | null): Promise<string | null> {
  if (!storage || !key) return null;
  try {
    const object = await storage.get(key);
    const b = object?.bytes;
    if (!b || b.length < 8 || b.length > 2 * 1024 * 1024) return null;
    const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (!png && !jpeg) return null;
    return `data:${png ? "image/png" : "image/jpeg"};base64,${Buffer.from(b).toString("base64")}`;
  } catch {
    return null;
  }
}

export interface HigherDocumentFilesOptions {
  /** Moteur PDF (tests : faux moteur) ; défaut : Chromium configuré par l'environnement, démarré à la première utilisation. */
  readonly renderer?: PdfRenderer;
}

/** `ReportcardsDeps` dédiées au scellement et au rendu des documents d'autres modules (clés et moteur lus dans l'environnement). */
export function createDocumentSealingDeps(kit: AdapterKit, storage: ObjectStorage | null, options: HigherDocumentFilesOptions = {}): ReportcardsDeps {
  const renderer: PdfRenderer | undefined = options.renderer;
  let lazyRenderer: PdfRenderer | undefined;
  const base = (kit.env.REPORTCARDS_VERIFICATION_BASE_URL ?? kit.env.V2_APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return createReportcardsDeps({
    db: kit.tenantDb,
    systemDb: kit.systemDb,
    clock: kit.clock,
    logger: kit.logger,
    keysProvider: () => keyProviderFromEnv(kit.env),
    portsProvider: () => ({
      ...(storage ? { storage } : {}),
      get renderer() {
        // Moteur injecté (tests), sinon celui que le worker a enregistré (`setReportcardsWorkerResources`), sinon Chromium
        // configuré par l'environnement, démarré à la première utilisation.
        return renderer ?? reportcardsWorkerOverrides().overrides.renderer ?? (lazyRenderer ??= puppeteerRendererFromEnv(kit.env));
      },
    }),
    config: { verificationBaseUrl: base || null },
  });
}

export function createHigherDocumentFiles(kit: AdapterKit, storage: ObjectStorage | null, options: HigherDocumentFilesOptions = {}): DocumentFilesPort {
  const rc = createDocumentSealingDeps(kit, storage, options);
  // Les gabarits de plateforme sont publiés à la création d'un tenant : un déploiement ANTÉRIEUR à ces gabarits les reçoit ici,
  // une fois par processus (idempotent, table globale).
  let templates: Promise<Result<unknown, AppError>> | null = null;
  const ensureTemplates = (): Promise<Result<unknown, AppError>> => {
    templates ??= ensureBuiltinTemplates(rc).then((r) => {
      if (!r.ok) templates = null;
      return r;
    });
    return templates;
  };
  return {
    async prepareSeal() {
      const registered = await ensureSigningKeyRegistered(rc);
      return registered.ok ? ok(undefined) : err(registered.error);
    },

    async seal(ctx: RequestContext, tx: Tx, input) {
      // La clé publique est déjà enregistrée (`prepareSeal`, hors transaction) : ici, signature pure + index dans la transaction de higher.
      const signed = await signDocumentHash(rc, { kind: input.kind, snapshotHash: input.snapshotHash, verificationCode: input.verificationCode, issuedAt: input.issuedAt }, { registerKey: false });
      if (!signed.ok) return signed;
      await registerVerificationFor(tx, ctx, { code: input.verificationCode, documentKind: input.kind, documentId: input.documentId });
      return ok({ signingKeyId: signed.value.keyId, signature: signed.value.signature });
    },

    async render(ctx: RequestContext, input): Promise<Result<{ objectKey: string; pdfHash: string; pages: number; templateKey: string; templateVersion: number }, AppError>> {
      if (!storage) return err(portUnavailable("StoragePort"));
      const published = await ensureTemplates();
      if (!published.ok) return published;
      const logo = await logoDataUri(storage, input.logoRef);
      const rendered = await renderDocumentPdf(rc, ctx, {
        kind: input.kind,
        templateKey: input.templateKey,
        context: input.context as Record<string, unknown>,
        title: input.title,
        issuedAt: input.issuedAt,
        verificationCode: input.verificationCode,
        ...(logo ? { assets: { logo } } : {}),
      });
      if (!rendered.ok) return rendered;
      const objectKey = `tenants/${ctx.tenantId}/higher/documents/${input.documentId}.pdf`;
      const stored = await storage.put(objectKey, rendered.value.pdf, { contentType: "application/pdf" });
      await rc.db.run(ctx, (tx) => registerFileHashFor(tx, ctx, { pdfHash: stored.sha256, code: input.verificationCode }));
      return ok({ objectKey, pdfHash: stored.sha256, pages: rendered.value.pages, templateKey: rendered.value.templateKey, templateVersion: rendered.value.templateVersion });
    },

    async signedUrl(_ctx: RequestContext, objectKey: string, options: { ttlSec: number; fileName: string }): Promise<string> {
      if (!storage) throw portUnavailable("StoragePort");
      const signed = await storage.signedUrl(objectKey, { ttlSeconds: options.ttlSec, fileName: options.fileName, contentType: "application/pdf" });
      return signed.url;
    },
  };
}

/** Vérificateur public d'un document du supérieur : lit le document (higher), reportcards revérifie signature et empreinte. */
export function createHigherDocumentVerifier(higher: HigherDeps): ExternalDocumentVerifier {
  return { describe: (tenantId, documentId) => describeDocumentForVerification(higher, tenantId, documentId) };
}
