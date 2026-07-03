"use client";

import * as React from "react";
import { cn } from "../utils";
import { Checkbox } from "../checkbox";
import { Badge } from "../badge";
import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { Button } from "../button";
import { Input } from "../input";
import { Label } from "../label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";
import { BookOpen, User, Clock, CheckCircle2, X, Settings } from "lucide-react";

export interface Course {
  id: string;
  name: string;
  code: string;
  hoursTotal: number;
  isAssigned: boolean;
  teacherName?: string;
  description?: string;
}

export interface SelectedCourse {
  courseId: string;
  requiredHours: number;
  preferredSessionDuration: number;
  maxSessionsPerWeek?: number;
}

export interface CourseSelectorProps {
  courses: Course[];
  selectedCourses: SelectedCourse[];
  onSelectionChange: (selectedCourses: SelectedCourse[]) => void;
  className?: string;
  showTeachers?: boolean;
  showHourConfiguration?: boolean;
  allowSelectAll?: boolean;
  disabled?: boolean;
  maxSelections?: number;
}

const sessionDurationOptions = [
  { value: 60, label: "1 heure" },
  { value: 90, label: "1h30" },
  { value: 120, label: "2 heures" },
  { value: 180, label: "3 heures" },
  { value: 240, label: "4 heures" },
];

const CourseSelector = React.forwardRef<
  HTMLDivElement,
  CourseSelectorProps
>(({ 
  courses,
  selectedCourses,
  onSelectionChange,
  className,
  showTeachers = true,
  showHourConfiguration = true,
  allowSelectAll = true,
  disabled = false,
  maxSelections,
  ...props 
}, ref) => {
  const handleCourseToggle = (courseId: string, checked: boolean) => {
    if (disabled) return;
    
    let newSelection: SelectedCourse[];
    
    if (checked) {
      // Check max selections limit
      if (maxSelections && selectedCourses.length >= maxSelections) {
        return;
      }
      
      const course = courses.find(c => c.id === courseId);
      if (course) {
        const newSelectedCourse: SelectedCourse = {
          courseId,
          requiredHours: course.hoursTotal,
          preferredSessionDuration: 120, // 2 hours default
        };
        newSelection = [...selectedCourses, newSelectedCourse];
      } else {
        return;
      }
    } else {
      newSelection = selectedCourses.filter(c => c.courseId !== courseId);
    }
    
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    
    if (selectedCourses.length === courses.length) {
      // Deselect all
      onSelectionChange([]);
    } else {
      // Select all (respecting max limit)
      const coursesToSelect = maxSelections 
        ? courses.slice(0, maxSelections)
        : courses;
      
      const newSelection = coursesToSelect.map(course => ({
        courseId: course.id,
        requiredHours: course.hoursTotal,
        preferredSessionDuration: 120,
      }));
      
      onSelectionChange(newSelection);
    }
  };

  const updateCourseHours = (courseId: string, hours: number) => {
    const newSelection = selectedCourses.map(course => 
      course.courseId === courseId 
        ? { ...course, requiredHours: hours }
        : course
    );
    onSelectionChange(newSelection);
  };

  const updateSessionDuration = (courseId: string, duration: number) => {
    const newSelection = selectedCourses.map(course => 
      course.courseId === courseId 
        ? { ...course, preferredSessionDuration: duration }
        : course
    );
    onSelectionChange(newSelection);
  };

  const updateMaxSessionsPerWeek = (courseId: string, maxSessions?: number) => {
    const newSelection = selectedCourses.map(course => 
      course.courseId === courseId 
        ? { ...course, maxSessionsPerWeek: maxSessions }
        : course
    );
    onSelectionChange(newSelection);
  };

  const getTotalRequiredHours = () => {
    return selectedCourses.reduce((sum, course) => sum + course.requiredHours, 0);
  };

  const getEstimatedSessions = () => {
    return selectedCourses.reduce((sum, course) => {
      const sessionsNeeded = Math.ceil((course.requiredHours * 60) / course.preferredSessionDuration);
      return sum + sessionsNeeded;
    }, 0);
  };

  return (
    <div ref={ref} className={cn("space-y-4", className)} {...props}>
      {/* Header with select all and summary */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm text-gray-600">
            {selectedCourses.length} / {courses.length} cours sélectionnés
            {maxSelections && ` (max: ${maxSelections})`}
          </div>
          {selectedCourses.length > 0 && (
            <div className="text-xs text-gray-500">
              {getTotalRequiredHours()}h totales • ~{getEstimatedSessions()} sessions estimées
            </div>
          )}
        </div>
        
        {allowSelectAll && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={disabled}
          >
            {selectedCourses.length === courses.length ? (
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
        )}
      </div>

      {/* Course list */}
      <div className="space-y-3">
        {courses.map(course => {
          const isSelected = selectedCourses.some(c => c.courseId === course.id);
          const selectedCourse = selectedCourses.find(c => c.courseId === course.id);

          return (
            <Card
              key={course.id}
              className={cn(
                "transition-colors",
                isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200",
                disabled && "opacity-50"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => handleCourseToggle(course.id, checked as boolean)}
                    disabled={disabled || Boolean(maxSelections && !isSelected && selectedCourses.length >= maxSelections)}
                    className="mt-1"
                  />
                  
                  <div className="flex-1 space-y-3">
                    {/* Course info */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <BookOpen className="h-4 w-4 text-gray-500" />
                        <h4 className="font-medium">{course.name}</h4>
                        <Badge variant="outline">{course.code}</Badge>
                        {course.isAssigned && (
                          <Badge variant="secondary">
                            Assigné
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Volume horaire: {course.hoursTotal}h
                        </div>
                        
                        {showTeachers && course.teacherName && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {course.teacherName}
                          </div>
                        )}
                      </div>
                      
                      {course.description && (
                        <p className="text-sm text-gray-600 mt-1">
                          {course.description}
                        </p>
                      )}
                    </div>

                    {/* Configuration options (only when selected) */}
                    {isSelected && selectedCourse && showHourConfiguration && (
                      <div className="pt-3 border-t border-gray-200">
                        <div className="flex items-center gap-2 mb-3">
                          <Settings className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-700">
                            Configuration
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Required hours */}
                          <div className="space-y-2">
                            <Label htmlFor={`hours-${course.id}`} className="text-xs">
                              Heures requises
                            </Label>
                            <Input
                              id={`hours-${course.id}`}
                              type="number"
                              min="1"
                              max={course.hoursTotal}
                              value={selectedCourse.requiredHours}
                              onChange={(e) => 
                                updateCourseHours(course.id, parseInt(e.target.value) || 0)
                              }
                              disabled={disabled}
                              className="text-sm"
                            />
                          </div>

                          {/* Session duration */}
                          <div className="space-y-2">
                            <Label className="text-xs">
                              Durée par session
                            </Label>
                            <Select
                              value={selectedCourse.preferredSessionDuration.toString()}
                              onValueChange={(value) => 
                                updateSessionDuration(course.id, parseInt(value))
                              }
                              disabled={disabled}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {sessionDurationOptions.map(option => (
                                  <SelectItem key={option.value} value={option.value.toString()}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Max sessions per week */}
                          <div className="space-y-2">
                            <Label className="text-xs">
                              Max sessions/semaine
                            </Label>
                            <Select
                              value={selectedCourse.maxSessionsPerWeek?.toString() || "unlimited"}
                              onValueChange={(value) =>
                                updateMaxSessionsPerWeek(
                                  course.id,
                                  value === "unlimited" ? undefined : parseInt(value)
                                )
                              }
                              disabled={disabled}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Aucune limite" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unlimited">Aucune limite</SelectItem>
                                <SelectItem value="1">1 session</SelectItem>
                                <SelectItem value="2">2 sessions</SelectItem>
                                <SelectItem value="3">3 sessions</SelectItem>
                                <SelectItem value="4">4 sessions</SelectItem>
                                <SelectItem value="5">5 sessions</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Estimated sessions */}
                        <div className="mt-3 text-xs text-gray-600">
                          Sessions estimées: {Math.ceil((selectedCourse.requiredHours * 60) / selectedCourse.preferredSessionDuration)}
                          {selectedCourse.maxSessionsPerWeek && (
                            <span> • Durée estimée: {Math.ceil(Math.ceil((selectedCourse.requiredHours * 60) / selectedCourse.preferredSessionDuration) / selectedCourse.maxSessionsPerWeek)} semaines</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary footer */}
      {selectedCourses.length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center">
                <div className="font-medium text-blue-900">{selectedCourses.length}</div>
                <div className="text-blue-700">Cours sélectionnés</div>
              </div>
              <div className="text-center">
                <div className="font-medium text-blue-900">{getTotalRequiredHours()}h</div>
                <div className="text-blue-700">Heures totales</div>
              </div>
              <div className="text-center">
                <div className="font-medium text-blue-900">{getEstimatedSessions()}</div>
                <div className="text-blue-700">Sessions estimées</div>
              </div>
              <div className="text-center">
                <div className="font-medium text-blue-900">
                  {Math.round(getTotalRequiredHours() / selectedCourses.length * 10) / 10}h
                </div>
                <div className="text-blue-700">Moyenne par cours</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
});

CourseSelector.displayName = "CourseSelector";

export { CourseSelector };
