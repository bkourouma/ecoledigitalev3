"use client";

import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
} from '@ecoledigitale/ui';
import {
  Users,
  GraduationCap,
} from 'lucide-react';

interface Class {
  id: string;
  name: string;
  capacity: number;
  programmeName: string;
}

interface ClassSelectorProps {
  classes: Class[];
  selectedClassId: string;
  onClassChange: (classId: string) => void;
  isLoading?: boolean;
  showStats?: boolean;
  stats?: {
    total_sessions: number;
    total_courses: number;
    total_hours: number;
  };
}

export function ClassSelector({
  classes = [],
  selectedClassId,
  onClassChange,
  isLoading = false,
  showStats = false,
  stats
}: ClassSelectorProps) {
  // Ensure classes is an array
  const safeClasses = Array.isArray(classes) ? classes : [];
  const selectedClass = safeClasses.find(cls => cls.id === selectedClassId);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center text-foreground">
          <Users className="h-5 w-5 mr-2 text-foreground" />
          Sélection de la Classe
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <Select 
              value={selectedClassId} 
              onValueChange={onClassChange}
              disabled={isLoading}
            >
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue placeholder="Choisir une classe..." />
              </SelectTrigger>
              <SelectContent>
                {safeClasses.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    <span className="text-foreground">{cls.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Selected Class Info */}
        {selectedClass && (
          <div className="p-3 bg-accent rounded-lg border border-border">
            <div className="flex items-center space-x-2">
              <GraduationCap className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground">{selectedClass.name}</span>
            </div>
          </div>
        )}

        {/* Quick Stats */}
        {showStats && stats && selectedClassId && (
          <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border">
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{stats.total_sessions}</div>
              <div className="text-xs text-muted-foreground">Sessions</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{stats.total_courses}</div>
              <div className="text-xs text-muted-foreground">Cours</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{Math.round(stats.total_hours)}</div>
              <div className="text-xs text-muted-foreground">Heures</div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span className="ml-2 text-sm text-muted-foreground">Chargement...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ClassSelector;
