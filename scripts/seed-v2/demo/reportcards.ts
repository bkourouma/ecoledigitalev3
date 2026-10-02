/**
 * Bulletins : identité de l'établissement, signataire, gabarit du pack, lot d'émission pour la première période, rendu PDF par
 * le worker (Chromium), signature Ed25519, publication. Les résultats viennent du jeu de règles de DÉMONSTRATION : la
 * vérification publique des bulletins annonce « démonstration » (filigrane imposé par la provenance des règles).
 */
import { at, waitFor, type DemoKit } from "./kit";

export interface BulletinOptions {
  pack: "PRIMARY" | "SECONDARY" | "HIGHER";
  templateKey: string;
  legalName: string;
  /** Période des bulletins (défaut : première période de l'année). */
  periodId?: string;
}

export async function issueBulletins(kit: DemoKit, options: BulletinOptions): Promise<{ cards: Array<{ id: string; verificationCode: string }> }> {
  const { ctx } = kit;
  const owner = ctx.owner;
  const periodId = options.periodId ?? at(ctx.periodIds, 0, "première période");
  await owner.put("/api/v1/reportcards/branding", {
    legalName: options.legalName,
    headerLeft: ["République de Côte d'Ivoire (démonstration)"],
    address: "Abidjan, Côte d'Ivoire",
    primaryColor: "#14532D",
  });
  const sig = await owner.post("/api/v1/reportcards/signatories", { fullName: "Directeur Fictif", title: "Chef d'établissement", jobFunction: "Direction" }, 201);
  const templates = await owner.get("/api/v1/reportcards/templates");
  const list = (templates.body.items ?? templates.body) as Array<{ key: string; signatureSlots?: Array<{ key?: string; slot?: string }> }>;
  const tpl = list.find((t) => t.key === options.templateKey);
  if (!tpl) throw new Error(`Gabarit introuvable : ${options.templateKey}`);
  const slots = tpl.signatureSlots ?? [];
  await owner.put("/api/v1/reportcards/template-configs", {
    documentKind: "REPORT_CARD",
    pack: options.pack,
    templateKey: options.templateKey,
    options: {},
    signatureAssignments: slots.slice(0, 1).map((s) => ({ slot: s.key ?? s.slot, signatoryId: sig.body.id })),
  });
  const batch = await owner.post("/api/v1/reportcards/batches", { classroomId: ctx.classroomId, academicPeriodId: periodId, idempotencyKey: `demo-bulletins-${ctx.data.slug}-${periodId}` }, [200, 202]);
  const total = Number((batch.body.batch ?? batch.body).total ?? 0);
  if (total === 0) throw new Error(`Aucun bulletin dans le lot : ${JSON.stringify(batch.body).slice(0, 300)}`);
  const cards = await waitFor(
    async () => {
      const page = await owner.get(`/api/v1/reportcards/report-cards?classroomId=${ctx.classroomId}&academicPeriodId=${periodId}&live=true`);
      const items = page.body.items as Array<{ id: string; verificationCode: string; renderStatus: string }>;
      if (items.length < total) return false;
      if (items.some((c) => c.renderStatus === "FAILED")) throw new Error("Rendu d'un bulletin en échec (voir le journal du worker : Chromium disponible ?).");
      return items.every((c) => c.renderStatus === "RENDERED") ? items : false;
    },
    { label: "rendu PDF des bulletins", timeoutMs: 180_000, intervalMs: 1000 },
  );
  await owner.post("/api/v1/reportcards/publish", { reportCardIds: cards.map((c) => c.id) });
  kit.count("reportCards", cards.length);
  kit.note(`Bulletins : ${cards.length} PDF signés (Ed25519), publiés aux familles ; vérification publique avec la mention « démonstration ».`);
  return { cards };
}
