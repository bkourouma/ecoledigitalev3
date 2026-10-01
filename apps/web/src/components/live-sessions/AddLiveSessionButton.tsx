"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Video, Loader2 } from "lucide-react";

/**
 * Button that creates (or finds the existing) live session for a school timetable session, then
 * navigates the user to the room page. Drop it anywhere a teacher manages a session:
 *
 *   <AddLiveSessionButton parentType="instance" parentId={sessionInstanceId} />
 *
 * The create endpoint is idempotent: clicking twice returns the same live session.
 * The notification dispatch to enrolled students is fire-and-forget on the API side.
 */

export interface AddLiveSessionButtonProps {
  parentType: "instance";
  parentId: string;
  recordingEnabled?: boolean;
  className?: string;
  label?: string;
}

export function AddLiveSessionButton({
  parentType,
  parentId,
  recordingEnabled = true,
  className,
  label = "Démarrer la séance en direct",
}: AddLiveSessionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/live-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentType, parentId, recordingEnabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      const id = json?.data?.id;
      if (!id) throw new Error("Réponse invalide");
      router.push(`/live/${id}`);
    } catch (err: any) {
      setError(err?.message ?? "Erreur inconnue");
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
        {label}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
