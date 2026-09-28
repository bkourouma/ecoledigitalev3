"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PlayCircle, AlertTriangle } from "lucide-react";

interface RecordingDto {
  id: string;
  egressId: string;
  s3Key: string | null;
  status: "processing" | "ready" | "failed" | "aborted";
  durationSec: number | null;
  fileSizeBytes: number | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  const units = ["o", "Ko", "Mo", "Go"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

export default function RecordingsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [activeUrl, setActiveUrl] = React.useState<string | null>(null);
  const [activeError, setActiveError] = React.useState<string | null>(null);

  const recordingsQuery = useQuery({
    queryKey: ["live-session-recordings", id],
    queryFn: async (): Promise<RecordingDto[]> => {
      const res = await fetch(`/api/v1/live-sessions/${id}/recordings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j?.data ?? [];
    },
    refetchInterval: (q) => {
      // Keep polling while at least one recording is still processing.
      const data = q.state.data as RecordingDto[] | undefined;
      return data?.some((r) => r.status === "processing") ? 10_000 : false;
    },
    enabled: Boolean(id),
  });

  const playRecording = async (recordingId: string) => {
    setActiveError(null);
    try {
      const res = await fetch(
        `/api/v1/live-sessions/${id}/recordings/${recordingId}/playback-url`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setActiveUrl(j?.data?.url ?? null);
    } catch (err: any) {
      setActiveError(err?.message ?? "Lecture impossible");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Enregistrements de la séance</h1>
      <p className="text-neutral-500 whitespace-nowrap text-sm md:text-base text-muted-foreground">
        Les enregistrements sont disponibles quelques minutes après la fin de la séance.
      </p>

      {recordingsQuery.isLoading && (
        <div className="mt-8 flex items-center gap-2 text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      {recordingsQuery.data && recordingsQuery.data.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
          Aucun enregistrement pour cette séance.
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {recordingsQuery.data?.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900">
                {new Date(r.startedAt).toLocaleString("fr-FR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Durée {formatDuration(r.durationSec)} · Taille {formatBytes(r.fileSizeBytes)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
                  (r.status === "ready"
                    ? "bg-green-100 text-green-700"
                    : r.status === "processing"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700")
                }
              >
                {r.status === "ready" ? "Prêt" : r.status === "processing" ? "En cours" : "Échec"}
              </span>
              {r.status === "ready" && (
                <button
                  type="button"
                  onClick={() => playRecording(r.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <PlayCircle className="h-4 w-4" /> Lire
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {activeError && (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {activeError}
        </div>
      )}

      {activeUrl && (
        <div className="mt-6">
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-black">
            <video
              key={activeUrl}
              controls
              className="aspect-video w-full"
              src={activeUrl}
            />
          </div>
        </div>
      )}
    </div>
  );
}
