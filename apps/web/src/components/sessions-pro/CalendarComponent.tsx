"use client";

import { useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import { CalendarEvent } from "@ecoledigitale/contracts";
import { SessionEventCard } from "./SessionEventCard";
import { cn } from "@/lib/utils";

interface CalendarComponentProps {
  events: CalendarEvent[];
  initialView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";
  currentDate?: Date;
  onDateChange?: (date: Date) => void;
  onDateClick?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  className?: string;
}

export function CalendarComponent({
  events,
  initialView = "dayGridMonth",
  currentDate,
  onDateChange,
  onDateClick,
  onEventClick,
  className,
}: CalendarComponentProps) {
  const calendarRef = useRef<FullCalendar>(null);

  // Debug: Log events received by component
  useEffect(() => {
    if (events && events.length > 0) {
      console.log('📅 CalendarComponent: Events received for FullCalendar:', {
        count: events.length,
        firstEvent: events[0],
        firstEventKeys: Object.keys(events[0] || {}),
      });
    } else {
      console.log('📅 CalendarComponent: No events received');
    }
  }, [events]);


  // Custom event content renderer
  const renderEventContent = (eventInfo: any) => {
    const event = eventInfo.event;
    const extendedProps = event.extendedProps as CalendarEvent["extendedProps"];

    console.log('🎨 renderEventContent called:', {
      eventId: event.id,
      eventTitle: event.title,
      view: eventInfo.view.type,
      start: event.start,
      end: event.end,
    });

    // Convert start/end to ISO string if they're Date objects, otherwise use as-is
    const startStr = event.start instanceof Date 
      ? event.start.toISOString() 
      : (typeof event.start === 'string' ? event.start : "");
    const endStr = event.end instanceof Date 
      ? event.end.toISOString() 
      : (typeof event.end === 'string' ? event.end : "");

    return (
      <SessionEventCard
        event={{
          id: event.id,
          title: event.title,
          start: startStr,
          end: endStr,
          backgroundColor: event.backgroundColor || "",
          borderColor: event.borderColor || "",
          extendedProps: extendedProps,
        }}
        view={eventInfo.view.type}
        onClick={() => {
          if (onEventClick) {
            onEventClick({
              id: event.id,
              title: event.title,
              start: startStr,
              end: endStr,
              backgroundColor: event.backgroundColor || "",
              borderColor: event.borderColor || "",
              extendedProps: extendedProps,
            });
          }
        }}
      />
    );
  };

  // Update view when initialView prop changes
  useEffect(() => {
    if (calendarRef.current) {
      // Use setTimeout to avoid calling during render
      const timeoutId = setTimeout(() => {
        if (calendarRef.current) {
          const calendarApi = calendarRef.current.getApi();
          const currentViewType = calendarApi.view.type;
          
          // Only change view if it's different from current view
          if (currentViewType !== initialView) {
            try {
              calendarApi.changeView(initialView);
            } catch (error) {
              console.error('Error changing calendar view:', error);
            }
          }
        }
      }, 0);
      
      return () => clearTimeout(timeoutId);
    }
  }, [initialView]);

  // Update date when currentDate prop changes (from toolbar navigation)
  useEffect(() => {
    if (calendarRef.current && currentDate) {
      // Use setTimeout to avoid calling during render
      const timeoutId = setTimeout(() => {
        if (calendarRef.current && currentDate) {
          const calendarApi = calendarRef.current.getApi();
          const currentCalendarDate = calendarApi.getDate();
          
          // Compare month and year, not just the day
          const currentMonth = currentDate.getMonth();
          const currentYear = currentDate.getFullYear();
          const calendarMonth = currentCalendarDate.getMonth();
          const calendarYear = currentCalendarDate.getFullYear();
          
          if (currentMonth !== calendarMonth || currentYear !== calendarYear) {
            try {
              calendarApi.gotoDate(currentDate);
            } catch (error) {
              console.error('Error changing calendar date:', error);
            }
          }
        }
      }, 0);
      
      return () => clearTimeout(timeoutId);
    }
  }, [currentDate]);

  // Listen to FullCalendar's events and date changes
  useEffect(() => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi();
      
      // Debug: Listen to events being set
      const handleEventsSet = (arg: any) => {
        try {
          // Safely access events array
          const eventsArray = (arg && Array.isArray(arg.events)) ? arg.events : [];
          console.log('📊 FullCalendar eventsSet:', {
            eventsCount: eventsArray.length,
            view: calendarApi.view.type,
            start: calendarApi.view.activeStart,
            end: calendarApi.view.activeEnd,
            hasEvents: eventsArray.length > 0,
            argType: typeof arg,
            argKeys: arg ? Object.keys(arg) : [],
          });
          if (eventsArray.length > 0) {
            console.log('📊 First event in FullCalendar:', {
              id: eventsArray[0].id,
              title: eventsArray[0].title,
              start: eventsArray[0].start,
              end: eventsArray[0].end,
            });
          }
        } catch (error) {
          console.error('❌ Error in handleEventsSet:', error);
        }
      };
      
      calendarApi.on('eventsSet', handleEventsSet);
      
      // Listen to date changes for sync
      if (onDateChange) {
        const handleDatesSet = (arg: any) => {
          // Use requestAnimationFrame to avoid state updates during render
          requestAnimationFrame(() => {
            if (calendarRef.current) {
              const calendarApi = calendarRef.current.getApi();
              const viewDate = calendarApi.getDate();
              
              if (currentDate) {
                const currentMonth = currentDate.getMonth();
                const currentYear = currentDate.getFullYear();
                const viewMonth = viewDate.getMonth();
                const viewYear = viewDate.getFullYear();
                
                // Only update if month or year changed to avoid unnecessary updates
                if (currentMonth !== viewMonth || currentYear !== viewYear) {
                  onDateChange(viewDate);
                }
              } else {
                onDateChange(viewDate);
              }
            }
          });
        };
        
        calendarApi.on('datesSet', handleDatesSet);
        
        return () => {
          calendarApi.off('eventsSet', handleEventsSet);
          calendarApi.off('datesSet', handleDatesSet);
        };
      }
      
      return () => {
        calendarApi.off('eventsSet', handleEventsSet);
      };
    }
  }, [onDateChange, currentDate]);

  // Debug: Log events format before passing to FullCalendar
  useEffect(() => {
    if (events.length > 0) {
      console.log('🔍 Events format for FullCalendar:', {
        count: events.length,
        firstEvent: events[0],
        firstEventStartType: typeof events[0]?.start,
        firstEventEndType: typeof events[0]?.end,
        firstEventStartValue: events[0]?.start,
        firstEventEndValue: events[0]?.end,
      });
    }
  }, [events]);

  return (
    <div className={cn("w-full", className)}>
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView={initialView}
        locale={frLocale}
        events={events}
        eventContent={renderEventContent}
        headerToolbar={false} // We'll use custom toolbar
        height="auto"
        aspectRatio={typeof window !== 'undefined' && window.innerWidth < 640 ? 1.2 : 1.8} // T111: Responsive aspect ratio
        firstDay={1} // Start week on Monday
        weekends={true}
        editable={false} // Disable drag-and-drop for public calendar
        selectable={false}
        selectMirror={false}
        dayMaxEvents={true}
        moreLinkClick="popover"
        dateClick={(arg) => {
          if (onDateClick) {
            onDateClick(arg.date);
          }
        }}
        eventClick={(arg) => {
          arg.jsEvent.preventDefault();
          if (onEventClick) {
            const event = arg.event;
            onEventClick({
              id: event.id,
              title: event.title,
              start: event.start?.toISOString() || "",
              end: event.end?.toISOString() || "",
              backgroundColor: event.backgroundColor || "",
              borderColor: event.borderColor || "",
              extendedProps: event.extendedProps as CalendarEvent["extendedProps"],
            });
          }
        }}
        eventDisplay="block"
        // Ensure events are visible even when outside the current view range
        eventStartEditable={false}
        eventDurationEditable={false}
        // View-specific configurations (T111: Responsive)
        views={{
          dayGridMonth: {
            allDaySlot: false, // Hide all-day slot in month view
            dayMaxEvents: typeof window !== 'undefined' && window.innerWidth < 640 ? 2 : true, // Fewer events on mobile
            moreLinkClick: "popover",
            // Ensure events from the entire month are loaded
            fixedWeekCount: false,
          },
          timeGridWeek: {
            allDaySlot: false,
            slotMinTime: "08:00:00",
            slotMaxTime: "20:00:00",
            slotDuration: "01:00:00",
            slotLabelInterval: "01:00:00",
            // Responsive: Hide weekends on small screens
            weekends: typeof window !== 'undefined' && window.innerWidth >= 640,
          },
          timeGridDay: {
            allDaySlot: false,
            slotMinTime: "08:00:00",
            slotMaxTime: "20:00:00",
            slotDuration: "01:00:00",
            slotLabelInterval: "01:00:00",
          },
          listWeek: {
            // Mobile-friendly list view
            listDayFormat: { weekday: 'short', day: 'numeric', month: 'short' },
            listDaySideFormat: false,
            // Show events from a wider date range to include all sessions
            // Use listYear format to show all events from the year
            duration: { year: 1 },
            // Ensure events are displayed
            eventDisplay: 'block',
          },
          listYear: {
            // Show all events from the entire year
            listDayFormat: { weekday: 'short', day: 'numeric', month: 'short' },
            listDaySideFormat: false,
            eventDisplay: 'block',
          },
        }}
        // Styling
        eventClassNames="cursor-pointer"
        dayHeaderClassNames="font-semibold text-gray-700"
        // French locale settings
        buttonText={{
          today: "Aujourd'hui",
          month: "Mois",
          week: "Semaine",
          day: "Jour",
          list: "Liste",
        }}
      />
    </div>
  );
}

