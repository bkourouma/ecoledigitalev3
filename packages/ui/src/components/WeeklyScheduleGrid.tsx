"use client";

import * as React from "react";
import { cn } from "../utils";
import { Badge } from "../badge";
import { Card, CardContent } from "../card";

export interface ScheduleSession {
  id: string;
  courseId: string;
  courseName: string;
  teacherId?: string;
  teacherName?: string;
  classroomId?: string;
  classroomName?: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  weekPattern?: string;
}

export interface WeeklyScheduleGridProps {
  sessions: ScheduleSession[];
  className?: string;
  onSessionClick?: (session: ScheduleSession) => void;
  showTeachers?: boolean;
  showClassrooms?: boolean;
  compact?: boolean;
  highlightConflicts?: boolean;
  conflictingSessions?: string[];
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

const timeSlots = [
  "08:00", "09:00", "10:00", "11:00", "12:00", 
  "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"
];

const WeeklyScheduleGrid = React.forwardRef<
  HTMLDivElement,
  WeeklyScheduleGridProps
>(({ 
  sessions, 
  className, 
  onSessionClick,
  showTeachers = true,
  showClassrooms = true,
  compact = false,
  highlightConflicts = false,
  conflictingSessions = [],
  ...props 
}, ref) => {
  const days = compact 
    ? ["monday", "tuesday", "wednesday", "thursday", "friday"]
    : ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  const getSessionsForSlot = (day: string, time: string) => {
    return sessions.filter(session => {
      if (session.dayOfWeek !== day) return false;
      
      const sessionHour = parseInt(session.startTime.split(':')[0]);
      const slotHour = parseInt(time.split(':')[0]);
      
      return sessionHour === slotHour;
    });
  };

  const getSessionDuration = (session: ScheduleSession) => {
    const start = new Date(`1970-01-01T${session.startTime}`);
    const end = new Date(`1970-01-01T${session.endTime}`);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60); // hours
  };

  const getSessionColor = (session: ScheduleSession) => {
    if (highlightConflicts && conflictingSessions.includes(session.id)) {
      return "bg-red-100 border-red-300 text-red-900";
    }
    
    // Color based on course name hash for consistency
    const hash = session.courseName.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    const colors = [
      "bg-blue-100 border-blue-300 text-blue-900",
      "bg-green-100 border-green-300 text-green-900",
      "bg-purple-100 border-purple-300 text-purple-900",
      "bg-orange-100 border-orange-300 text-orange-900",
      "bg-pink-100 border-pink-300 text-pink-900",
      "bg-indigo-100 border-indigo-300 text-indigo-900",
      "bg-teal-100 border-teal-300 text-teal-900",
      "bg-yellow-100 border-yellow-300 text-yellow-900",
    ];
    
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div
      ref={ref}
      className={cn("overflow-x-auto", className)}
      {...props}
    >
      <div className={cn(
        "min-w-[800px] grid gap-1 bg-gray-50 p-4 rounded-lg",
        `grid-cols-${days.length + 1}`
      )}>
        {/* Header */}
        <div className="font-medium text-center p-2 bg-white rounded border">
          Horaires
        </div>
        {days.map(day => (
          <div key={day} className="font-medium text-center p-2 bg-white rounded border">
            {dayNames[day as keyof typeof dayNames]}
          </div>
        ))}

        {/* Time slots */}
        {timeSlots.map(time => (
          <React.Fragment key={time}>
            <div className="text-sm text-gray-600 p-2 text-center border-r bg-white rounded">
              {time}
            </div>
            {days.map(day => {
              const sessionsInSlot = getSessionsForSlot(day, time);
              
              return (
                <div key={`${day}-${time}`} className="p-1 min-h-[60px] relative">
                  {sessionsInSlot.map((session, index) => {
                    const duration = getSessionDuration(session);
                    const colorClass = getSessionColor(session);
                    
                    return (
                      <Card
                        key={session.id}
                        className={cn(
                          "border rounded p-2 text-xs cursor-pointer transition-all duration-200 hover:shadow-md",
                          colorClass,
                          compact ? "mb-1" : "mb-2",
                          index > 0 && "mt-1" // Stack multiple sessions
                        )}
                        style={{
                          minHeight: compact ? "50px" : `${Math.max(60, duration * 30)}px`
                        }}
                        onClick={() => onSessionClick?.(session)}
                      >
                        <CardContent className="p-0 space-y-1">
                          <div className="font-medium leading-tight">
                            {session.courseName}
                          </div>
                          
                          <div className="text-xs opacity-80">
                            {session.startTime} - {session.endTime}
                          </div>
                          
                          {showTeachers && session.teacherName && (
                            <div className="text-xs opacity-75">
                              👨‍🏫 {session.teacherName}
                            </div>
                          )}
                          
                          {showClassrooms && session.classroomName && (
                            <div className="text-xs opacity-75">
                              📍 {session.classroomName}
                            </div>
                          )}
                          
                          {session.weekPattern && session.weekPattern !== 'weekly' && (
                            <Badge variant="outline" className="text-xs">
                              {session.weekPattern === 'biweekly' && 'Bi-hebdo'}
                              {session.weekPattern === 'monthly' && 'Mensuel'}
                              {session.weekPattern === 'custom' && 'Personnalisé'}
                            </Badge>
                          )}
                          
                          {highlightConflicts && conflictingSessions.includes(session.id) && (
                            <Badge variant="destructive" className="text-xs">
                              Conflit
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                  
                  {sessionsInSlot.length === 0 && (
                    <div className="w-full h-full min-h-[60px] border-2 border-dashed border-gray-200 rounded bg-gray-50/50" />
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      
      {/* Legend */}
      {highlightConflicts && conflictingSessions.length > 0 && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-red-800">
            <div className="w-3 h-3 bg-red-200 border border-red-300 rounded"></div>
            <span>Sessions en conflit ({conflictingSessions.length})</span>
          </div>
        </div>
      )}
      
      {/* Statistics */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="text-center">
          <div className="font-medium text-gray-900">{sessions.length}</div>
          <div className="text-gray-600">Sessions totales</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-gray-900">
            {sessions.reduce((sum, s) => sum + (s.durationMinutes / 60), 0).toFixed(1)}h
          </div>
          <div className="text-gray-600">Heures totales</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-gray-900">
            {new Set(sessions.map(s => s.courseId)).size}
          </div>
          <div className="text-gray-600">Cours différents</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-gray-900">
            {new Set(sessions.map(s => s.dayOfWeek)).size}
          </div>
          <div className="text-gray-600">Jours utilisés</div>
        </div>
      </div>
    </div>
  );
});

WeeklyScheduleGrid.displayName = "WeeklyScheduleGrid";

export { WeeklyScheduleGrid };
