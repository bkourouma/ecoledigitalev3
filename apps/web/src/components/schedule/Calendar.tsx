"use client";

import React, { useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg, DateSelectArg, DatesSetArg } from "@fullcalendar/core";

type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  classId: string;
  courseId: string;
};

interface CalendarProps {
  events: CalendarEvent[];
  onMove: (id: string, newStart: Date, newEnd: Date) => Promise<void>;
  onResize: (id: string, newEnd: Date) => Promise<void>;
  onEventClick?: (event: CalendarEvent) => void;
  onDateSelect?: (start: Date, end: Date) => void;
}

export default function Calendar({ events, onMove, onResize, onEventClick, onDateSelect }: CalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api || events.length === 0) return;

    const visibleStart = api.view.activeStart.getTime();
    const visibleEnd = api.view.activeEnd.getTime();
    const hasVisibleEvent = events.some((event) => {
      const start = event.start.getTime();
      return start >= visibleStart && start < visibleEnd;
    });

    if (!hasVisibleEvent) {
      const now = Date.now();
      const nextEvent =
        events
          .filter((event) => event.start.getTime() >= now)
          .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ??
        [...events].sort((a, b) => a.start.getTime() - b.start.getTime())[0];

      if (nextEvent) {
        api.gotoDate(nextEvent.start);
      }
    }
  }, [events]);

  const handleEventDrop = async (info: EventDropArg) => {
    try {
      const start = info.event.start;
      const end = info.event.end;
      
      if (!start || !end) {
        console.error("Invalid event dates for drop:", { start, end });
        info.revert();
        return;
      }
      
      await onMove(info.event.id, start, end);
    } catch (error) {
      info.revert();
      console.error("Drop failed:", error);
    }
  };

  const handleEventResize = async (info: any) => {
    try {
      const end = info.event.end;
      
      if (!end) {
        console.error("Invalid event end date for resize:", { end });
        info.revert();
        return;
      }
      
      await onResize(info.event.id, end);
    } catch (error) {
      info.revert();
      console.error("Resize failed:", error);
    }
  };

  const handleEventClick = (info: EventClickArg) => {
    const event = events.find(e => e.id === info.event.id);
    if (event && onEventClick) {
      onEventClick(event);
    }
  };

  const handleSelect = (info: DateSelectArg) => {
    if (onDateSelect) {
      onDateSelect(info.start, info.end);
    }
  };

  return (
    <div className="fullcalendar-wrapper">
      {/* Correct FullCalendar CSS imports for Next.js */}
      <style jsx global>{`
        @import "@fullcalendar/core/main.css";
        @import "@fullcalendar/timegrid/main.css";
        @import "@fullcalendar/daygrid/main.css";

        /* Fix date header visibility - dark text on light background */
        .fc .fc-col-header-cell-cushion {
          color: #1f2937 !important;
          font-weight: 600 !important;
        }

        /* Fix day numbers in month view */
        .fc .fc-daygrid-day-number {
          color: #1f2937 !important;
        }

        /* Fix day names */
        .fc .fc-col-header-cell {
          background-color: #f9fafb !important;
        }

        /* Ensure time labels are also visible */
        .fc .fc-timegrid-axis-cushion,
        .fc .fc-timegrid-slot-label-cushion {
          color: #374151 !important;
        }

        /* Make "today" column more visible */
        .fc .fc-day-today {
          background-color: #eff6ff !important;
        }

        /* Calendar event styling for better contrast */
        .fc-event {
          border: 1px solid rgba(0, 0, 0, 0.1) !important;
        }
      `}</style>
      
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale="fr"
        slotMinTime="06:00:00"
        slotMaxTime="20:00:00"
        slotDuration="00:15:00"
        allDaySlot={false}
        selectable={true}
        selectMirror={true}
        selectOverlap={false}
        editable={true}
        eventDurationEditable={true}
        eventResizableFromStart={false}
        select={handleSelect}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        height="auto"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'timeGridWeek,timeGridDay,dayGridMonth'
        }}
        buttonText={{
          today: "Aujourd'hui",
          week: 'Semaine',
          day: 'Jour',
          month: 'Mois'
        }}
        events={events
          .filter(e => e && e.id && e.start && e.end && !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()))
          .map(e => ({
            id: e.id,
            title: e.title || 'Sans titre',
            start: e.start.toISOString(),
            end: e.end.toISOString(),
            extendedProps: {
              classId: e.classId || '',
              courseId: e.courseId || '',
            }
          }))}
        businessHours={{
          daysOfWeek: [1, 2, 3, 4, 5, 6],
          startTime: '08:00',
          endTime: '18:00',
        }}
      />
    </div>
  );
}
