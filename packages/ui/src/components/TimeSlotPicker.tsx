"use client";

import * as React from "react";
import { cn } from "../utils";
import { Checkbox } from "../checkbox";
import { Badge } from "../badge";
import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { Button } from "../button";
import { Clock, Calendar, CheckCircle2, X } from "lucide-react";

export interface TimeSlot {
  id: string;
  name: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  priority: number;
  maxConcurrentSessions?: number;
  isActive?: boolean;
}

export interface TimeSlotPickerProps {
  timeSlots: TimeSlot[];
  selectedSlots: string[];
  onSelectionChange: (selectedSlots: string[]) => void;
  className?: string;
  groupByDay?: boolean;
  showPriority?: boolean;
  showDuration?: boolean;
  allowSelectAll?: boolean;
  disabled?: boolean;
  maxSelections?: number;
}

const dayNames = {
  monday: "Lundi",
  tuesday: "Mardi", 
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const TimeSlotPicker = React.forwardRef<
  HTMLDivElement,
  TimeSlotPickerProps
>(({ 
  timeSlots,
  selectedSlots,
  onSelectionChange,
  className,
  groupByDay = true,
  showPriority = true,
  showDuration = true,
  allowSelectAll = true,
  disabled = false,
  maxSelections,
  ...props 
}, ref) => {
  const handleSlotToggle = (slotId: string, checked: boolean) => {
    if (disabled) return;
    
    let newSelection: string[];
    
    if (checked) {
      // Check max selections limit
      if (maxSelections && selectedSlots.length >= maxSelections) {
        return;
      }
      newSelection = [...selectedSlots, slotId];
    } else {
      newSelection = selectedSlots.filter(id => id !== slotId);
    }
    
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    
    if (selectedSlots.length === timeSlots.length) {
      // Deselect all
      onSelectionChange([]);
    } else {
      // Select all (respecting max limit)
      const allSlots = timeSlots.map(slot => slot.id);
      const slotsToSelect = maxSelections 
        ? allSlots.slice(0, maxSelections)
        : allSlots;
      onSelectionChange(slotsToSelect);
    }
  };

  const handleDayToggle = (day: string) => {
    if (disabled) return;
    
    const daySlots = timeSlots.filter(slot => slot.dayOfWeek === day);
    const daySlotIds = daySlots.map(slot => slot.id);
    const allDaySelected = daySlotIds.every(id => selectedSlots.includes(id));
    
    let newSelection: string[];
    
    if (allDaySelected) {
      // Deselect all slots for this day
      newSelection = selectedSlots.filter(id => !daySlotIds.includes(id));
    } else {
      // Select all slots for this day (respecting max limit)
      const slotsToAdd = daySlotIds.filter(id => !selectedSlots.includes(id));
      const availableSlots = maxSelections 
        ? Math.max(0, maxSelections - selectedSlots.length)
        : slotsToAdd.length;
      
      newSelection = [
        ...selectedSlots,
        ...slotsToAdd.slice(0, availableSlots)
      ];
    }
    
    onSelectionChange(newSelection);
  };

  const calculateDuration = (startTime: string, endTime: string) => {
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h${minutes}min`;
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 3) return "bg-green-100 text-green-800";
    if (priority === 2) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getPriorityLabel = (priority: number) => {
    if (priority >= 3) return "Haute";
    if (priority === 2) return "Moyenne";
    return "Basse";
  };

  if (groupByDay) {
    // Group slots by day
    const slotsByDay = timeSlots.reduce((acc, slot) => {
      if (!acc[slot.dayOfWeek]) acc[slot.dayOfWeek] = [];
      acc[slot.dayOfWeek].push(slot);
      return acc;
    }, {} as Record<string, TimeSlot[]>);

    // Sort days and slots within each day
    const sortedDays = dayOrder.filter(day => slotsByDay[day]);
    Object.keys(slotsByDay).forEach(day => {
      slotsByDay[day].sort((a, b) => a.startTime.localeCompare(b.startTime));
    });

    return (
      <div ref={ref} className={cn("space-y-4", className)} {...props}>
        {/* Header with select all */}
        {allowSelectAll && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedSlots.length} / {timeSlots.length} créneaux sélectionnés
              {maxSelections && ` (max: ${maxSelections})`}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              disabled={disabled}
            >
              {selectedSlots.length === timeSlots.length ? (
                <>
                  <X className="h-4 w-4 mr-2" />
                  Tout désélectionner
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Tout sélectionner
                </>
              )}
            </Button>
          </div>
        )}

        {/* Days */}
        {sortedDays.map(day => {
          const daySlots = slotsByDay[day];
          const daySlotIds = daySlots.map(slot => slot.id);
          const selectedInDay = daySlotIds.filter(id => selectedSlots.includes(id)).length;
          const allDaySelected = selectedInDay === daySlots.length;
          const someDaySelected = selectedInDay > 0 && selectedInDay < daySlots.length;

          return (
            <Card key={day}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={allDaySelected}
                      ref={someDaySelected ? (el) => {
                        if (el) el.indeterminate = true;
                      } : undefined}
                      onCheckedChange={() => handleDayToggle(day)}
                      disabled={disabled}
                    />
                    <Calendar className="h-5 w-5" />
                    <span>{dayNames[day as keyof typeof dayNames]}</span>
                  </div>
                  <Badge variant="outline">
                    {selectedInDay} / {daySlots.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {daySlots.map(slot => {
                  const isSelected = selectedSlots.includes(slot.id);
                  const duration = calculateDuration(slot.startTime, slot.endTime);

                  return (
                    <div
                      key={slot.id}
                      className={cn(
                        "flex items-center gap-3 p-3 border rounded-lg transition-colors",
                        isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200 hover:border-gray-300",
                        disabled && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSlotToggle(slot.id, checked as boolean)}
                        disabled={disabled || (maxSelections && !isSelected && selectedSlots.length >= maxSelections)}
                      />
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{slot.name}</span>
                          {showPriority && (
                            <Badge className={getPriorityColor(slot.priority)}>
                              {getPriorityLabel(slot.priority)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {slot.startTime} - {slot.endTime}
                          </div>
                          {showDuration && (
                            <span>({duration})</span>
                          )}
                          {slot.maxConcurrentSessions && slot.maxConcurrentSessions > 1 && (
                            <span>Max: {slot.maxConcurrentSessions} sessions</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // Simple list view (not grouped by day)
  return (
    <div ref={ref} className={cn("space-y-3", className)} {...props}>
      {/* Header */}
      {allowSelectAll && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {selectedSlots.length} / {timeSlots.length} créneaux sélectionnés
            {maxSelections && ` (max: ${maxSelections})`}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={disabled}
          >
            {selectedSlots.length === timeSlots.length ? (
              <>
                <X className="h-4 w-4 mr-2" />
                Tout désélectionner
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Tout sélectionner
              </>
            )}
          </Button>
        </div>
      )}

      {/* Time slots */}
      {timeSlots.map(slot => {
        const isSelected = selectedSlots.includes(slot.id);
        const duration = calculateDuration(slot.startTime, slot.endTime);

        return (
          <div
            key={slot.id}
            className={cn(
              "flex items-center gap-3 p-3 border rounded-lg transition-colors",
              isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200 hover:border-gray-300",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => handleSlotToggle(slot.id, checked as boolean)}
              disabled={disabled || (maxSelections && !isSelected && selectedSlots.length >= maxSelections)}
            />
            
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{slot.name}</span>
                <Badge variant="outline" className="text-xs">
                  {dayNames[slot.dayOfWeek as keyof typeof dayNames]}
                </Badge>
                {showPriority && (
                  <Badge className={getPriorityColor(slot.priority)}>
                    {getPriorityLabel(slot.priority)}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {slot.startTime} - {slot.endTime}
                </div>
                {showDuration && (
                  <span>({duration})</span>
                )}
                {slot.maxConcurrentSessions && slot.maxConcurrentSessions > 1 && (
                  <span>Max: {slot.maxConcurrentSessions} sessions</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

TimeSlotPicker.displayName = "TimeSlotPicker";

export { TimeSlotPicker };
