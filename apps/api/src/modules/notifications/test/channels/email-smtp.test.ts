/**
 * Canal e-mail contre un serveur SMTP SIMULÉ (`smtp-server`, développement) : aucun envoi réel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import type { AddressInfo } from "node:net";
import { createSmtpChannel, classifySmtpError, readSmtpSettings } from "../../infrastructure/channels/email-smtp";
import type { ChannelAdapter, ChannelMessage } from "../../application/ports";

const received: ParsedMail[] = [];
let server: SMTPServer;
let port: number;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onRcptTo(address, _session, cb) {
      if (address.address.startsWith("inconnu@")) return cb(Object.assign(new Error("550 5.1.1 User unknown"), { responseCode: 550 }));
      if (address.address.startsWith("greylist@")) return cb(Object.assign(new Error("450 4.2.0 Greylisted, try again later"), { responseCode: 450 }));
      cb();
    },
    onData(stream, _session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        simpleParser(Buffer.concat(chunks)).then((m) => {
          received.push(m);
          cb();
        }, cb);
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.server.address() as AddressInfo).port;
});

const opened: ChannelAdapter[] = [];
const channelOf = (options: Parameters<typeof createSmtpChannel>[0]): ChannelAdapter => {
  const c = createSmtpChannel(options);
  opened.push(c);
  return c;
};

afterAll(async () => {
  await Promise.all(opened.map((c) => c.close?.()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const env = (extra: Record<string, string> = {}) => ({ SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_FROM_EMAIL: "no-reply@ecole.example.org", SMTP_FROM_NAME: "EcoleDigitale", ...extra });

const message = (patch: Partial<ChannelMessage> = {}): ChannelMessage => ({
  tenantId: "0190aaaa-0000-7000-8000-000000000001",
  deliveryId: "0190aaaa-0000-7000-8000-0000000000d1",
  channel: "EMAIL",
  address: "awa.kone@famille.example.org",
  userId: null,
  subject: "Absence de Awa Koné",
  text: "Bonjour,\n\nAwa a été absente le 02/10/2026.\n\nVoir https://ecole.example.org/v2/parent",
  templateCode: "absence",
  category: "ATTENDANCE",
  urgent: false,
  link: null,
  idempotencyKey: "0190aaaa-0000-7000-8000-0000000000d1",
  schoolName: "Groupe Scolaire Les Palmiers",
  senderName: "Les Palmiers",
  replyTo: "secretariat@ecole.example.org",
  legalFooter: "Établissement privé — RCCM CI-ABJ-2020-B-0001",
  unsubscribeUrl: "https://ecole.example.org/v2/notifications/unsubscribe?t=abc",
  ...patch,
});

describe("canal e-mail SMTP (serveur simulé)", () => {
  it("envoie un e-mail multipart complet : expéditeur, objet, texte, HTML, pied de page de conformité, en-têtes de désinscription", async () => {
    const channel = channelOf({ env: env(), requireUnsubscribeSecret: false, unsubscribeSecretPresent: true });
    expect(channel.status()).toEqual({ configured: true, missing: [] });
    const outcome = await channel.deliver(message());
    expect(outcome.status).toBe("SENT");
    const mail = received.at(-1)!;
    expect(mail.from?.value[0]).toMatchObject({ address: "no-reply@ecole.example.org", name: "Les Palmiers" });
    expect(mail.to).toMatchObject({ value: [{ address: "awa.kone@famille.example.org" }] });
    expect(mail.subject).toBe("Absence de Awa Koné");
    expect(mail.replyTo?.value[0]?.address).toBe("secretariat@ecole.example.org");
    expect(mail.text).toContain("Awa a été absente le 02/10/2026.");
    expect(mail.text).toContain("Se désinscrire : https://ecole.example.org/v2/notifications/unsubscribe?t=abc");
    expect(mail.text).toContain("RCCM CI-ABJ-2020-B-0001");
    expect(mail.html).toContain("Se désinscrire");
    expect(mail.html).toContain("Groupe Scolaire Les Palmiers");
    expect(mail.headerLines.find((h) => h.key === "list-unsubscribe")?.line).toContain("<https://ecole.example.org/v2/notifications/unsubscribe?t=abc>");
    expect(mail.headerLines.find((h) => h.key === "list-unsubscribe-post")?.line).toContain("List-Unsubscribe=One-Click");
    expect(mail.messageId).toBe("<0190aaaa-0000-7000-8000-0000000000d1@ecole.example.org>");
    expect(String(mail.headers.get("x-entity-ref-id"))).toBe("0190aaaa-0000-7000-8000-0000000000d1");
  });

  it("échappe tout contenu dangereux dans le HTML et refuse l'injection d'en-tête par l'objet", async () => {
    const channel = channelOf({ env: env(), requireUnsubscribeSecret: false, unsubscribeSecretPresent: true });
    await channel.deliver(message({ subject: "Objet\r\nBcc: pirate@evil.example", text: '<img src=x onerror="alert(1)"> & <script>x</script>', schoolName: "<b>École</b>" }));
    const mail = received.at(-1)!;
    expect(mail.bcc).toBeUndefined();
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("une urgence est marquée prioritaire", async () => {
    const channel = channelOf({ env: env(), requireUnsubscribeSecret: false, unsubscribeSecretPresent: true });
    await channel.deliver(message({ urgent: true }));
    const lines = received.at(-1)!.headerLines;
    expect(lines.find((h) => h.key === "x-priority")?.line).toMatch(/1/);
    expect(lines.find((h) => h.key === "importance")?.line).toMatch(/high/i);
  });

  it("REBOND : une boîte inconnue (550 au RCPT) est un rebond définitif, sans adresse complète dans le message", async () => {
    const channel = channelOf({ env: env(), requireUnsubscribeSecret: false, unsubscribeSecretPresent: true });
    const outcome = await channel.deliver(message({ address: "inconnu@famille.example.org" }));
    expect(outcome.status).toBe("BOUNCED");
    if (outcome.status === "BOUNCED") {
      expect(outcome.code).toMatch(/^smtp_5/);
      expect(outcome.message).not.toContain("inconnu@famille.example.org");
    }
  });

  it("une réponse 4xx (liste grise) est une panne PASSAGÈRE : reprise avec backoff", async () => {
    const channel = channelOf({ env: env(), requireUnsubscribeSecret: false, unsubscribeSecretPresent: true });
    const outcome = await channel.deliver(message({ address: "greylist@famille.example.org" }));
    expect(outcome).toMatchObject({ status: "RETRY", code: "smtp_450" });
  });

  it("serveur injoignable : panne passagère (le journal réessaiera)", async () => {
    const channel = channelOf({ env: { ...env(), SMTP_PORT: "1" }, requireUnsubscribeSecret: false, unsubscribeSecretPresent: true });
    const outcome = await channel.deliver(message());
    expect(outcome.status).toBe("RETRY");
    await channel.close?.();
  });

  it("non configuré : échec EXPLICITE, variables manquantes nommées (jamais leurs valeurs)", async () => {
    const channel = channelOf({ env: {}, requireUnsubscribeSecret: false, unsubscribeSecretPresent: false });
    expect(channel.status()).toEqual({ configured: false, missing: ["SMTP_HOST", "SMTP_FROM_EMAIL"] });
    const outcome = await channel.deliver(message());
    expect(outcome).toMatchObject({ status: "FAILED", code: "channel_not_configured" });
  });

  it("en production, le secret de désinscription est exigé (conformité)", () => {
    const channel = channelOf({ env: env(), requireUnsubscribeSecret: true, unsubscribeSecretPresent: false });
    expect(channel.status()).toEqual({ configured: false, missing: ["NOTIFICATIONS_UNSUBSCRIBE_SECRET"] });
    expect(channelOf({ env: env(), requireUnsubscribeSecret: true, unsubscribeSecretPresent: true }).status().configured).toBe(true);
  });

  it("lit les réglages SMTP de l'environnement (mêmes variables que l'e-mail de comptes)", () => {
    const r = readSmtpSettings({ SMTP_HOST: "smtp.example.org", SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USER: "u@example.org", SMTP_PASSWORD: "pw" });
    expect(r.settings).toMatchObject({ host: "smtp.example.org", port: 465, secure: true, fromEmail: "u@example.org" });
  });

  it("classe les erreurs SMTP : 4xx passager, 5xx destinataire rebond, 5xx autre échec, authentification à reprendre", () => {
    expect(classifySmtpError({ responseCode: 421, message: "service not available" }).status).toBe("RETRY");
    expect(classifySmtpError({ responseCode: 550, command: "RCPT TO" }).status).toBe("BOUNCED");
    expect(classifySmtpError({ responseCode: 554, command: "DATA" }).status).toBe("FAILED");
    expect(classifySmtpError({ responseCode: 552 }).status).toBe("RETRY");
    expect(classifySmtpError({ code: "EAUTH" }).status).toBe("RETRY");
    expect(classifySmtpError({ code: "EENVELOPE" })).toMatchObject({ status: "FAILED", code: "invalid_address" });
    expect(classifySmtpError({ code: "ETIMEDOUT" }).status).toBe("RETRY");
  });
});
