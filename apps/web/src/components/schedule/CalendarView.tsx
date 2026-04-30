"use client";

import React from 'react';
import { motion } from 'framer-motion';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
} from '@ecoledigitale/ui';
import {
  Calendar as CalendarIcon,
  Clock,
  BookOpen,
  Users,
  MapPin,
  Trash2,
} from 'lucide-react';

interface CalendarSession {
  instance_id: string;
  session_date: string;
  start_datetime: string;
  end_datetime: string;
  status: string;
  classroom: string;
  class_id: string;
  class_name: string;
  course_id: string;
  course_name: string;
  course_code: string;
  teacher_id: string;
  teacher_name: string;
  day_of_week: string | number;
  duration_minutes: number;
}

interface CalendarViewProps {
  sessions: CalendarSession[];
  viewMode: 'week' | 'month';
  onSessionClick?: (session: CalendarSession) => void;
  onSessionDelete?: (session: CalendarSession) => void;
}

export function CalendarView({ sessions, viewMode, onSessionClick, onSessionDelete }: CalendarViewProps) {
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (datetimeString: string): string => {
    return new Date(datetimeString).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 border-green-200 font-medium">Terminé</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-800 border-red-200 font-medium">Annulé</Badge>;
      case 'rescheduled':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 font-medium">Reporté</Badge>;
      case 'scheduled':
      default:
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200 font-medium">Programmé</Badge>;
    }
  };

  const groupSessionsByDate = (sessions: CalendarSession[]) => {
    const grouped: { [date: string]: CalendarSession[] } = {};
    sessions.forEach(session => {
      const date = session.session_date;
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(session);
    });
    
    // Sort dates
    const sortedDates = Object.keys(grouped).sort();
    const sortedGrouped: { [date: string]: CalendarSession[] } = {};
    sortedDates.forEach(date => {
      // Sort sessions by time within each date
      sortedGrouped[date] = grouped[date].sort((a, b) => 
        new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
      );
    });
    
    return sortedGrouped;
  };

  const groupedSessions = groupSessionsByDate(sessions);

  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <CalendarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun cours programmé</h3>
          <p className="text-gray-600">
            Il n'y a pas de cours programmés pour cette période.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(groupedSessions).map(([date, dateSessions]) => (
        <motion.div
          key={date}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <CalendarIcon className="h-5 w-5 mr-2" />
                {formatDate(date)}
                <Badge variant="outline" className="ml-2">
                  {dateSessions.length} session{dateSessions.length > 1 ? 's' : ''}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dateSessions.map((session) => (
                  <SessionCard
                    key={session.instance_id}
                    session={session}
                    onClick={() => onSessionClick?.(session)}
                    onDelete={() => onSessionDelete?.(session)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

interface SessionCardProps {
  session: CalendarSession;
  onClick?: () => void;
  onDelete?: () => void;
}

function SessionCard({ session, onClick, onDelete }: SessionCardProps) {
  const formatTime = (datetimeString: string): string => {
    return new Date(datetimeString).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 border-green-200 font-medium">Terminé</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-800 border-red-200 font-medium">Annulé</Badge>;
      case 'rescheduled':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 font-medium">Reporté</Badge>;
      case 'scheduled':
      default:
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200 font-medium">Programmé</Badge>;
    }
  };

  const getDurationText = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0 && mins > 0) {
      return `${hours}h${mins}`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${mins}min`;
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete();
    }
  };

  return (
    <div
      className={`flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg transition-colors shadow-sm ${
        onClick ? 'hover:bg-gray-50 cursor-pointer hover:shadow-md' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Clock className="h-4 w-4 text-gray-600" />
          <span className="font-semibold text-gray-900">
            {formatTime(session.start_datetime)} - {formatTime(session.end_datetime)}
          </span>
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
            {getDurationText(session.duration_minutes)}
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <BookOpen className="h-4 w-4 text-blue-600" />
          <span className="font-semibold text-gray-900">{session.course_name}</span>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{session.course_code}</Badge>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        {session.teacher_name && (
          <div className="flex items-center space-x-1 text-sm text-gray-700">
            <Users className="h-4 w-4 text-gray-600" />
            <span className="font-medium">{session.teacher_name}</span>
          </div>
        )}
        <div className="flex items-center space-x-1 text-sm text-gray-700">
          <MapPin className="h-4 w-4 text-gray-600" />
          <span className="font-medium">{session.classroom}</span>
        </div>
        {getStatusBadge(session.status)}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="ml-2 p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
            aria-label="Delete session"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default CalendarView;
