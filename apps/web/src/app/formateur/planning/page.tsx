"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Calendar as CalendarIcon, Plus, Loader2 } from "lucide-react";
import { useFormateurSchedule } from "@/lib/hooks/use-formateur-schedule";
import { CalendarComponent } from "@/components/sessions-pro/CalendarComponent";
import { CalendarToolbar } from "@/components/sessions-pro/CalendarToolbar";
import { SessionDetailModal } from "@/components/formateur/SessionDetailModal";
import { IndisponibiliteModal } from "@/components/formateur/IndisponibiliteModal";
import { IndisponibiliteList } from "@/components/formateur/IndisponibiliteList";
import type { CalendarEvent } from "@ecoledigitale/contracts";
import type { CalendarView } from "@/components/sessions-pro/CalendarToolbar";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function FormateurPlanningPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<CalendarView>("dayGridMonth");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [indispoModalOpen, setIndispoModalOpen] = useState(false);

  // Build calendar query from current date
  const calendarQuery = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentView === "dayGridMonth" ? currentDate.getMonth() + 1 : undefined;

    return {
      annee: year,
      mois: month,
      vue: currentView === "dayGridMonth" ? "mois" : currentView === "timeGridWeek" ? "semaine" : "liste",
    };
  }, [currentDate, currentView]);

  // Fetch schedule data
  const { data, isLoading, error } = useFormateurSchedule(calendarQuery);

  // Extract and format events from response
  // The API returns sessions and unavailability as FullCalendar events
  const events = (data?.data?.sessions || []).map((event: any) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    backgroundColor: event.backgroundColor || "#3b82f6",
    borderColor: event.backgroundColor || "#3b82f6",
    extendedProps: event.extendedProps || {},
  }));

  const handleEventClick = (event: CalendarEvent) => {
    // Only show modal for sessions, not unavailability
    if (event.extendedProps?.type === "session") {
      setSelectedEvent(event);
      setModalOpen(true);
    }
  };

  const handleDateClick = (date: Date) => {
    setCurrentDate(date);
    if (currentView !== "dayGridMonth") {
      setCurrentView("timeGridDay");
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement du planning...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-4">
                {error instanceof Error ? error.message : "Erreur lors du chargement du planning"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-3">
                  <CalendarIcon className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Mon Planning</CardTitle>
                  <p className="text-muted-foreground text-sm mt-1">
                    Consultez vos sessions et gérez vos indisponibilités
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIndispoModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Ajouter une indisponibilité
              </button>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Calendar Toolbar */}
      <div className="mb-4">
        <CalendarToolbar
          currentDate={currentDate}
          currentView={currentView}
          onViewChange={setCurrentView}
          onDateChange={setCurrentDate}
          onFiltersToggle={() => {}}
          showFilters={false}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-3">
          <ErrorBoundary>
            <Card>
              <CardContent className="p-6">
                <CalendarComponent
                  events={events}
                  initialView={currentView}
                  onDateClick={handleDateClick}
                  onEventClick={handleEventClick}
                />
              </CardContent>
            </Card>
          </ErrorBoundary>
        </div>

        {/* Unavailability List Sidebar */}
        <div className="lg:col-span-1">
          <IndisponibiliteList />
        </div>
      </div>

      {/* Session Detail Modal */}
      <SessionDetailModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        event={selectedEvent}
      />

      {/* Unavailability Modal */}
      <IndisponibiliteModal
        open={indispoModalOpen}
        onOpenChange={setIndispoModalOpen}
      />
    </div>
  );
}

