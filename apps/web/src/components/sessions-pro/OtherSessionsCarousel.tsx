"use client";

import { SessionListItem } from "@ecoledigitale/contracts/src/sessions-pro";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@ecoledigitale/ui";

interface OtherSessionsCarouselProps {
  sessions: SessionListItem[];
  currentSessionId: string;
  formationSlug: string;
  className?: string;
}

export function OtherSessionsCarousel({
  sessions,
  currentSessionId,
  formationSlug,
  className,
}: OtherSessionsCarouselProps) {
  // Filter out current session
  const otherSessions = sessions.filter((s) => s.id !== currentSessionId);

  if (otherSessions.length === 0) {
    return null;
  }

  const [currentIndex, setCurrentIndex] = useState(0);
  const itemsPerPage = 3;
  const totalPages = Math.ceil(otherSessions.length / itemsPerPage);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : totalPages - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < totalPages - 1 ? prev + 1 : 0));
  };

  const visibleSessions = otherSessions.slice(
    currentIndex * itemsPerPage,
    (currentIndex + 1) * itemsPerPage
  );

  return (
    <Card className={cn("mt-6", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Autres sessions de cette formation</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              disabled={totalPages <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={totalPages <= 1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {visibleSessions.map((session) => {
            const dateDebut = new Date(session.date_debut);
            return (
              <Link
                key={session.id}
                href={`/formations-professionnelles/sessions/${session.id}`}
                className="block"
              >
                <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-mono text-muted-foreground">
                        {session.code_session}
                      </span>
                    </div>
                    <div className="font-semibold text-foreground mb-2">
                      {format(dateDebut, "d MMMM yyyy", { locale: fr })}
                    </div>
                    <div className="text-sm text-foreground/80 mb-2">
                      {session.mode_formation}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Places:</span>
                      <span
                        className={cn(
                          "font-semibold",
                          session.places_disponibles > 0
                            ? "text-green-400"
                            : "text-red-400"
                        )}
                      >
                        {session.places_disponibles} disponible
                        {session.places_disponibles > 1 ? "s" : ""}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

