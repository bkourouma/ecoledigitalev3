import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Types
export interface TimeSlot {
  id: string;
  name: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  priority: number;
  maxConcurrentSessions: number;
  isActive: boolean;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  hoursTotal: number;
  isAssigned: boolean;
  teacherName?: string;
}

export interface SelectedCourse {
  courseId: string;
  requiredHours: number;
  preferredSessionDuration: number;
  maxSessionsPerWeek?: number;
}

export interface GenerationPreferences {
  balanceWorkload: boolean;
  avoidBackToBackSessions: boolean;
  preferMorningSlots: boolean;
  maxDailyHours?: number;
  allowWeekendSessions: boolean;
}

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
  weekPattern: string;
}

export interface GeneratedSchedule {
  id: string;
  scheduleData: {
    sessions: ScheduleSession[];
    totalHours: number;
    weeklyDistribution: Record<string, number>;
  };
  optimizationScore: number;
  conflictsDetected: any[];
  isApproved: boolean;
  createdAt: string;
}

export interface GenerationRequest {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  errorMessage?: string;
  createdAt: string;
  processingStartedAt?: string;
  processingCompletedAt?: string;
}

// Store interface
interface ScheduleGenerationState {
  // Selection state
  selectedClassId: string;
  selectedCourses: SelectedCourse[];
  selectedTimeSlots: string[];
  generationPreferences: GenerationPreferences;
  
  // Available options
  availableCourses: Course[];
  availableTimeSlots: TimeSlot[];
  availableClassrooms: any[];
  classInfo: any;
  
  // Generation state
  currentRequest: GenerationRequest | null;
  currentSchedule: GeneratedSchedule | null;
  isGenerating: boolean;
  generationError: string | null;
  
  // UI state
  showAdvancedOptions: boolean;
  viewMode: 'grid' | 'list';
  
  // Actions - Selection
  setSelectedClass: (classId: string) => void;
  addSelectedCourse: (course: SelectedCourse) => void;
  removeSelectedCourse: (courseId: string) => void;
  updateSelectedCourse: (courseId: string, updates: Partial<SelectedCourse>) => void;
  setSelectedCourses: (courses: SelectedCourse[]) => void;
  
  addSelectedTimeSlot: (timeSlotId: string) => void;
  removeSelectedTimeSlot: (timeSlotId: string) => void;
  setSelectedTimeSlots: (timeSlotIds: string[]) => void;
  
  updateGenerationPreferences: (preferences: Partial<GenerationPreferences>) => void;
  
  // Actions - Available options
  setAvailableOptions: (options: {
    courses: Course[];
    timeSlots: TimeSlot[];
    classrooms: any[];
    classInfo: any;
  }) => void;
  
  // Actions - Generation
  setCurrentRequest: (request: GenerationRequest | null) => void;
  setCurrentSchedule: (schedule: GeneratedSchedule | null) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setGenerationError: (error: string | null) => void;
  
  // Actions - UI
  setShowAdvancedOptions: (show: boolean) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  
  // Actions - Utility
  reset: () => void;
  canGenerate: () => boolean;
  getTotalRequiredHours: () => number;
  getEstimatedSessions: () => number;
}

// Default values
const defaultPreferences: GenerationPreferences = {
  balanceWorkload: true,
  avoidBackToBackSessions: false,
  preferMorningSlots: false,
  allowWeekendSessions: false,
};

// Store implementation
export const useScheduleGenerationStore = create<ScheduleGenerationState>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedClassId: '',
      selectedCourses: [],
      selectedTimeSlots: [],
      generationPreferences: defaultPreferences,
      
      availableCourses: [],
      availableTimeSlots: [],
      availableClassrooms: [],
      classInfo: null,
      
      currentRequest: null,
      currentSchedule: null,
      isGenerating: false,
      generationError: null,
      
      showAdvancedOptions: false,
      viewMode: 'grid',
      
      // Selection actions
      setSelectedClass: (classId) => {
        set({
          selectedClassId: classId,
          // Reset dependent selections when class changes
          selectedCourses: [],
          selectedTimeSlots: [],
          availableCourses: [],
          availableTimeSlots: [],
          availableClassrooms: [],
          classInfo: null,
          currentRequest: null,
          currentSchedule: null,
        });
      },
      
      addSelectedCourse: (course) => {
        const { selectedCourses } = get();
        if (!selectedCourses.find(c => c.courseId === course.courseId)) {
          set({ selectedCourses: [...selectedCourses, course] });
        }
      },
      
      removeSelectedCourse: (courseId) => {
        const { selectedCourses } = get();
        set({ selectedCourses: selectedCourses.filter(c => c.courseId !== courseId) });
      },
      
      updateSelectedCourse: (courseId, updates) => {
        const { selectedCourses } = get();
        set({
          selectedCourses: selectedCourses.map(course =>
            course.courseId === courseId ? { ...course, ...updates } : course
          )
        });
      },
      
      setSelectedCourses: (courses) => {
        set({ selectedCourses: courses });
      },
      
      addSelectedTimeSlot: (timeSlotId) => {
        const { selectedTimeSlots } = get();
        if (!selectedTimeSlots.includes(timeSlotId)) {
          set({ selectedTimeSlots: [...selectedTimeSlots, timeSlotId] });
        }
      },
      
      removeSelectedTimeSlot: (timeSlotId) => {
        const { selectedTimeSlots } = get();
        set({ selectedTimeSlots: selectedTimeSlots.filter(id => id !== timeSlotId) });
      },
      
      setSelectedTimeSlots: (timeSlotIds) => {
        set({ selectedTimeSlots: timeSlotIds });
      },
      
      updateGenerationPreferences: (preferences) => {
        const { generationPreferences } = get();
        set({ generationPreferences: { ...generationPreferences, ...preferences } });
      },
      
      // Available options actions
      setAvailableOptions: (options) => {
        set({
          availableCourses: options.courses,
          availableTimeSlots: options.timeSlots,
          availableClassrooms: options.classrooms,
          classInfo: options.classInfo,
        });
      },
      
      // Generation actions
      setCurrentRequest: (request) => {
        set({ currentRequest: request });
      },
      
      setCurrentSchedule: (schedule) => {
        set({ currentSchedule: schedule });
      },
      
      setIsGenerating: (isGenerating) => {
        set({ isGenerating });
      },
      
      setGenerationError: (error) => {
        set({ generationError: error });
      },
      
      // UI actions
      setShowAdvancedOptions: (show) => {
        set({ showAdvancedOptions: show });
      },
      
      setViewMode: (mode) => {
        set({ viewMode: mode });
      },
      
      // Utility actions
      reset: () => {
        set({
          selectedClassId: '',
          selectedCourses: [],
          selectedTimeSlots: [],
          generationPreferences: defaultPreferences,
          availableCourses: [],
          availableTimeSlots: [],
          availableClassrooms: [],
          classInfo: null,
          currentRequest: null,
          currentSchedule: null,
          isGenerating: false,
          generationError: null,
          showAdvancedOptions: false,
          viewMode: 'grid',
        });
      },
      
      canGenerate: () => {
        const { selectedClassId, selectedCourses, selectedTimeSlots } = get();
        return !!(selectedClassId && selectedCourses.length > 0 && selectedTimeSlots.length > 0);
      },
      
      getTotalRequiredHours: () => {
        const { selectedCourses } = get();
        return selectedCourses.reduce((sum, course) => sum + course.requiredHours, 0);
      },
      
      getEstimatedSessions: () => {
        const { selectedCourses } = get();
        return selectedCourses.reduce((sum, course) => {
          const sessionsNeeded = Math.ceil((course.requiredHours * 60) / course.preferredSessionDuration);
          return sum + sessionsNeeded;
        }, 0);
      },
    }),
    {
      name: 'schedule-generation-store',
      // Only persist selection state, not generation results
      partialize: (state) => ({
        selectedClassId: state.selectedClassId,
        selectedCourses: state.selectedCourses,
        selectedTimeSlots: state.selectedTimeSlots,
        generationPreferences: state.generationPreferences,
        showAdvancedOptions: state.showAdvancedOptions,
        viewMode: state.viewMode,
      }),
    }
  )
);

// Selectors for common derived state
export const useScheduleGenerationSelectors = () => {
  const store = useScheduleGenerationStore();
  
  return {
    // Selection state
    hasValidSelection: store.canGenerate(),
    totalRequiredHours: store.getTotalRequiredHours(),
    estimatedSessions: store.getEstimatedSessions(),
    
    // Generation state
    isGenerationInProgress: store.isGenerating || store.currentRequest?.status === 'processing',
    hasGenerationResult: !!store.currentSchedule,
    hasGenerationError: !!store.generationError,
    
    // UI state
    canShowAdvancedOptions: store.selectedCourses.length > 0,
    shouldShowTimeSlots: !!store.selectedClassId && store.availableTimeSlots.length > 0,
  };
};
