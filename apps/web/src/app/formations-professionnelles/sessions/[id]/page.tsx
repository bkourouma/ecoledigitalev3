"use client";

import { use, useEffect } from "react";
import { Suspense } from "react";
import { SessionDetailPage } from "@/components/sessions-pro/SessionDetailPage";
import {
  useSessionDetail,
  useSessionAvailability,
  useSessionsList,
} from "@/lib/hooks/use-sessions-pro";
import ErrorBoundary from "@/components/ErrorBoundary";

function SessionDetailContent({ sessionId }: { sessionId: string }) {
  const { data: sessionData, isLoading, error } = useSessionDetail(sessionId);
  const {
    data: availabilityData,
    isLoading: isLoadingAvailability,
    refetch: refetchAvailability,
  } = useSessionAvailability(sessionId, {
    refetchInterval: 10000, // Poll every 10 seconds for faster updates
  });

  // Refetch availability when window gains focus (user returns to tab)
  useEffect(() => {
    const handleFocus = () => {
      refetchAvailability();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetchAvailability]);

  // Fetch other sessions of the same formation
  const { data: otherSessionsData } = useSessionsList(
    sessionData?.data?.formation?.id
      ? {
          formation_id: sessionData.data.formation.id,
          limit: 10,
        }
      : {}
  );

  const handleInscriptionClick = () => {
    // Navigate to enrollment form
    window.location.href = `/formations-professionnelles/inscription/session/${sessionId}`;
  };

  return (
    <SessionDetailPage
      session={sessionData?.data || null}
      availability={availabilityData?.data}
      otherSessions={otherSessionsData?.data?.sessions || []}
      isLoading={isLoading}
      isLoadingAvailability={isLoadingAvailability}
      onInscriptionClick={handleInscriptionClick}
    />
  );
}

export default function SessionDetailPageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-12">
            <span className="text-gray-600">Chargement...</span>
          </div>
        </div>
      }
    >
      <ErrorBoundary>
        <SessionDetailContent sessionId={id} />
      </ErrorBoundary>
    </Suspense>
  );
}

