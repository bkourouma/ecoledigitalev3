/**
 * Canal PUSH : Web Push avec VAPID (`NOTIFICATIONS_VAPID_PUBLIC_KEY`, `NOTIFICATIONS_VAPID_PRIVATE_KEY`,
 * `NOTIFICATIONS_VAPID_SUBJECT` = `mailto:` ou `https:`). Générer les clés : `npx web-push generate-vapid-keys`.
 *
 *  - un abonnement par APPAREIL ; l'envoi vise tous les appareils de l'utilisateur ;
 *  - la requête chiffrée (RFC 8291) est construite par `web-push` puis envoyée par `fetch` (testable avec un serveur simulé) ;
 *  - nettoyage : 404 / 410 du service push = abonnement EXPIRÉ, supprimé ; échecs passagers comptés (purge périodique) ;
 *  - issue : au moins un appareil atteint = envoyé ; aucun abonnement vivant = ignoré (`no_subscription`) ; panne passagère = reprise.
 */
import webpush from "web-push";
import type { ChannelAdapter, ChannelConfigStatus, ChannelMessage, ChannelOutcome, PushSubscriptionStore } from "../../application/ports";

const present = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

export interface WebPushOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly store: PushSubscriptionStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export function webPushStatus(env: Readonly<Record<string, string | undefined>>): ChannelConfigStatus & { subject: string | null } {
  const missing: string[] = [];
  if (!present(env.NOTIFICATIONS_VAPID_PUBLIC_KEY)) missing.push("NOTIFICATIONS_VAPID_PUBLIC_KEY");
  if (!present(env.NOTIFICATIONS_VAPID_PRIVATE_KEY)) missing.push("NOTIFICATIONS_VAPID_PRIVATE_KEY");
  const subject = present(env.NOTIFICATIONS_VAPID_SUBJECT);
  if (!subject) missing.push("NOTIFICATIONS_VAPID_SUBJECT");
  else if (!/^(mailto:|https:\/\/)/.test(subject)) missing.push("NOTIFICATIONS_VAPID_SUBJECT (mailto: ou https://)");
  return { configured: missing.length === 0, missing, subject };
}

export function createWebPushChannel(options: WebPushOptions): ChannelAdapter {
  const { env, store } = options;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const status = (): ChannelConfigStatus => {
    const s = webPushStatus(env);
    return { configured: s.configured, missing: s.missing };
  };

  return {
    channel: "PUSH",
    provider: "webpush",
    status,
    async deliver(m: ChannelMessage): Promise<ChannelOutcome> {
      const st = webPushStatus(env);
      if (!st.configured) return { status: "FAILED", code: "channel_not_configured", message: `Canal push non configuré (${st.missing.join(", ")}).` };
      const subs = await store.listForUser(m.tenantId, m.address);
      if (subs.length === 0) return { status: "SKIPPED", reason: "no_subscription" };
      const payload = JSON.stringify({ title: m.subject ?? m.schoolName, body: m.text.slice(0, 240), url: m.link, tag: m.templateCode, urgent: m.urgent });
      let reached = 0;
      let transient = 0;
      let expired = 0;
      let lastCode = "push_error";
      for (const sub of subs) {
        try {
          const req = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
            vapidDetails: { subject: st.subject!, publicKey: env.NOTIFICATIONS_VAPID_PUBLIC_KEY!, privateKey: env.NOTIFICATIONS_VAPID_PRIVATE_KEY! },
            TTL: m.urgent ? 24 * 3600 : 6 * 3600,
            urgency: m.urgent ? "high" : "normal",
            topic: undefined,
          }) as { method: string; headers: Record<string, string>; body: Buffer | string | null; endpoint: string };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          let res: Response;
          try {
            res = await doFetch(req.endpoint, { method: req.method, headers: req.headers, ...(req.body ? { body: req.body as never } : {}), signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
          if (res.status === 404 || res.status === 410) {
            await store.remove(m.tenantId, sub.id);
            expired += 1;
          } else if (res.ok) {
            await store.touch(m.tenantId, sub.id, now());
            reached += 1;
          } else {
            await store.recordFailure(m.tenantId, sub.id);
            if (res.status === 400 || res.status === 401 || res.status === 403) lastCode = `push_${res.status}`;
            else transient += 1;
          }
        } catch {
          await store.recordFailure(m.tenantId, sub.id).catch(() => undefined);
          transient += 1;
          lastCode = "push_unreachable";
        }
      }
      if (reached > 0) return { status: "SENT" };
      if (transient > 0) return { status: "RETRY", code: lastCode, message: "Le service de notifications push est temporairement indisponible." };
      if (expired === subs.length) return { status: "SKIPPED", reason: "no_subscription" };
      return { status: "FAILED", code: lastCode, message: "Le service push a refusé la notification." };
    },
  };
}
