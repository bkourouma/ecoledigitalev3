"use client";

import { useParams, useRouter } from "next/navigation";
import { LiveSessionRoom, type LiveSessionTokenResponse } from "@ecoledigitale/ui";

/**
 * /live/[id] — joining UI for school-side live sessions.
 *
 * Both teachers and students hit this page; moderator vs participant role is decided server-side
 * by the join-token endpoint (creator + tenant admin = moderator). Notification deep-links land
 * here directly via actionUrl in dispatchNotification.
 */
export default function LiveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  if (!id) return null;

  const getToken = async (): Promise<LiveSessionTokenResponse> => {
    const res = await fetch(`/api/v1/live-sessions/${id}/join-token`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json?.data?.token) throw new Error("Token manquant dans la réponse");
    return json.data as LiveSessionTokenResponse;
  };

  const onMute = async (identity: string) => {
    await fetch(`/api/v1/live-sessions/${id}/participants/${encodeURIComponent(identity)}/mute`, {
      method: "POST",
    });
  };

  const onKick = async (identity: string) => {
    await fetch(`/api/v1/live-sessions/${id}/participants/${encodeURIComponent(identity)}`, {
      method: "DELETE",
    });
  };

  const onEndSession = async () => {
    const ok = window.confirm("Terminer la séance pour tous les participants ?");
    if (!ok) return;
    await fetch(`/api/v1/live-sessions/${id}/end`, { method: "POST" });
    router.back();
  };

  return (
    <LiveSessionRoom
      title="Cours en direct"
      getToken={getToken}
      onLeave={() => router.back()}
      onMuteParticipant={onMute}
      onKickParticipant={onKick}
      onEndSession={onEndSession}
    />
  );
}
