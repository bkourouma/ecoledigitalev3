"use client";

import { useParams, useRouter } from "next/navigation";
import { LiveSessionRoom, type LiveSessionTokenResponse } from "@ecoledigitale/ui";

/**
 * /live/[id] — formation-pro learner join page. Calls the Next.js join-token route which
 * verifies the user has a CONFIRME inscription before minting a participant-only JWT.
 */
export default function LearnerLiveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  if (!id) return null;

  const getToken = async (): Promise<LiveSessionTokenResponse> => {
    const res = await fetch(`/api/apprenant/live-sessions/${id}/join-token`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json?.data?.token) throw new Error("Token manquant dans la réponse");
    return json.data as LiveSessionTokenResponse;
  };

  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-neutral-950">
      <LiveSessionRoom
        title="Cours en direct"
        getToken={getToken}
        onLeave={() => router.push("/mes-formations")}
      />
    </main>
  );
}
