"use client";

import { useState } from "react";
import { Button } from "@ecoledigitale/ui";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Filter,
  List,
  Grid3x3,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DeliveryMode } from "@ecoledigitale/contracts";

export type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";

interface CalendarToolbarProps {
  currentDate: Date;
  currentView: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onDateChange: (date: Date) => void;
  onFiltersToggle?: () => void;
  showFilters?: boolean;
  className?: string;
}

export function CalendarToolbar({
  currentDate,
  currentView,
  onViewChange,
  onDateChange,
  onFiltersToggle,
  showFilters = false,
  className,
}: CalendarToolbarProps) {
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);

  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (currentView === "dayGridMonth") {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (currentView === "timeGridWeek") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    onDateChange(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (currentView === "dayGridMonth") {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (currentView === "timeGridWeek") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    onDateChange(newDate);
  };

  const handleToday = () => {
    onDateChange(new Date());
  };

  const formatDateTitle = () => {
    if (currentView === "dayGridMonth") {
      return currentDate.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });
    } else if (currentView === "timeGridWeek") {
      const weekStart = new Date(currentDate);
      weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return `${weekStart.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
      })} - ${weekEnd.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;
    } else if (currentView === "timeGridDay") {
      return currentDate.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } else {
      return "Liste des sessions";
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-white rounded-lg border border-gray-200",
        className
      )}
    >
      {/* Left: Navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
          aria-label="Précédent"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleToday}
          aria-label="Aujourd'hui"
        >
          Aujourd'hui
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNext}
          aria-label="Suivant"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="ml-4 font-semibold text-lg capitalize">
          {formatDateTitle()}
        </div>
      </div>

      {/* Right: View switcher and filters */}
      <div className="flex items-center gap-2">
        {/* View switcher */}
        <div className="flex items-center gap-1 border border-gray-200 rounded-md p-1 bg-gray-50">
          <Button
            variant={currentView === "dayGridMonth" ? "default" : "outline"}
            size="sm"
            onClick={() => onViewChange("dayGridMonth")}
            aria-label="Vue mois"
            className={cn(
              currentView === "dayGridMonth" 
                ? "bg-primary text-primary-foreground" 
                : "bg-white hover:bg-gray-100 text-gray-700 border-gray-300"
            )}
          >
            <Grid3x3 className="w-4 h-4" />
          </Button>
          <Button
            variant={currentView === "timeGridWeek" ? "default" : "outline"}
            size="sm"
            onClick={() => onViewChange("timeGridWeek")}
            aria-label="Vue semaine"
            className={cn(
              currentView === "timeGridWeek" 
                ? "bg-primary text-primary-foreground" 
                : "bg-white hover:bg-gray-100 text-gray-700 border-gray-300"
            )}
          >
            <Calendar className="w-4 h-4" />
          </Button>
          <Button
            variant={currentView === "timeGridDay" ? "default" : "outline"}
            size="sm"
            onClick={() => onViewChange("timeGridDay")}
            aria-label="Vue jour"
            className={cn(
              currentView === "timeGridDay" 
                ? "bg-primary text-primary-foreground" 
                : "bg-white hover:bg-gray-100 text-gray-700 border-gray-300"
            )}
          >
            <Clock className="w-4 h-4" />
          </Button>
          <Button
            variant={currentView === "listWeek" ? "default" : "outline"}
            size="sm"
            onClick={() => onViewChange("listWeek")}
            aria-label="Vue liste"
            className={cn(
              currentView === "listWeek" 
                ? "bg-primary text-primary-foreground" 
                : "bg-white hover:bg-gray-100 text-gray-700 border-gray-300"
            )}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>

        {/* Filters toggle */}
        {onFiltersToggle && (
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={onFiltersToggle}
            aria-label="Filtres"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filtres
          </Button>
        )}
      </div>
    </div>
  );
}

