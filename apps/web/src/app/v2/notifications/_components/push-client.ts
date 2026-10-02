import type { NotifPushSubscribeBody } from "@ecoledigitale/contracts/v2/notifications";

/** Clé publique VAPID (base64url) -> octets attendus par `pushManager.subscribe`. */
export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Le navigateur sait recevoir des notifications Web Push (service worker + PushManager + Notification). */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type PushFailure = "unsupported" | "denied" | "failed";

export class PushError extends Error {
  constructor(readonly reason: PushFailure) {
    super(reason);
  }
}

/**
 * Abonne CET appareil : demande l'autorisation du navigateur, crée l'abonnement auprès du service de push du navigateur et
 * retourne le corps à enregistrer côté API. L'autorisation n'est demandée qu'à l'action explicite de la personne.
 */
export async function subscribeThisDevice(publicKey: string, deviceLabel: string): Promise<NotifPushSubscribeBody> {
  if (!pushSupported()) throw new PushError("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushError("denied");
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource }));
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!json.endpoint || !p256dh || !auth) throw new PushError("failed");
    return { endpoint: json.endpoint, keys: { p256dh, auth }, deviceLabel: deviceLabel.trim().slice(0, 80) || undefined, userAgent: navigator.userAgent.slice(0, 300) } as NotifPushSubscribeBody;
  } catch (e) {
    throw e instanceof PushError ? e : new PushError("failed");
  }
}
