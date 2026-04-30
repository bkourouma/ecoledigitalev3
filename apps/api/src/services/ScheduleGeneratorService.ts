import { Pool } from "pg";
import {
  SelectedCourse,
  GenerationPreferences,
  ScheduleSession,
  ScheduleConflict,
  DayOfWeek,
  TimeSlot,
} from "@ecoledigitale/contracts";

interface GenerationContext {
  tenantId: string;
  classId: string;
  startDate: string;
  selectedCourses: SelectedCourse[];
  availableTimeSlots: TimeSlot[];
  availableClassrooms: any[];
  generationPreferences: GenerationPreferences;
}

interface SessionCandidate {
  courseId: string;
  courseName: string;
  timeSlotId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  classroomId?: string;
  teacherId?: string;
  score: number;
}

interface GenerationResult {
  sessions: ScheduleSession[];
  optimizationScore: number;
  conflicts: ScheduleConflict[];
  totalHours: number;
  weeklyDistribution: Record<DayOfWeek, number>;
}

export class ScheduleGeneratorService {
  constructor(private pool: Pool) {}

  async generateSchedule(context: GenerationContext): Promise<GenerationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Validate input and prepare data
      await this.validateGenerationContext(context);

      // Step 2: Get additional context (teachers, classrooms)
      const enrichedContext = await this.enrichContext(context);

      // Step 3: Generate session candidates
      const candidates = await this.generateSessionCandidates(enrichedContext);

      // Step 4: Apply genetic algorithm for optimization
      const bestSchedule = await this.optimizeSchedule(candidates, enrichedContext);

      // Step 5: Detect conflicts and calculate scores
      const conflicts = this.detectConflicts(bestSchedule);
      const optimizationScore = this.calculateOptimizationScore(bestSchedule, enrichedContext);

      // Step 6: Calculate statistics
      const totalHours = this.calculateTotalHours(bestSchedule);
      const weeklyDistribution = this.calculateWeeklyDistribution(bestSchedule);

      const generationDuration = Date.now() - startTime;
      console.log(`Schedule generation completed in ${generationDuration}ms`);

      return {
        sessions: bestSchedule,
        optimizationScore,
        conflicts,
        totalHours,
        weeklyDistribution,
      };

    } catch (error) {
      console.error('Schedule generation failed:', error);
      throw new Error(`Failed to generate schedule: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async validateGenerationContext(context: GenerationContext): Promise<void> {
    if (!context.selectedCourses || context.selectedCourses.length === 0) {
      throw new Error('Au moins un cours doit être sélectionné');
    }

    if (!context.availableTimeSlots || context.availableTimeSlots.length === 0) {
      throw new Error('Au moins un créneau horaire doit être disponible');
    }

    // Validate total hours feasibility
    const totalRequiredHours = context.selectedCourses.reduce(
      (sum, course) => sum + course.requiredHours, 0
    );

    const totalAvailableHours = context.availableTimeSlots.reduce(
      (sum, slot) => {
        const start = new Date(`1970-01-01T${slot.startTime}`);
        const end = new Date(`1970-01-01T${slot.endTime}`);
        return sum + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }, 0
    );

    // Note: We now support rotation across multiple weeks, so we don't limit to 80% of one week
    // The rotation algorithm will distribute courses across available time slots over multiple weeks
    console.log(`📈 Total required: ${totalRequiredHours}h, Available per week: ${totalAvailableHours}h`);
  }

  private async enrichContext(context: GenerationContext): Promise<GenerationContext & {
    courseTeachers: Map<string, any>;
    classroomCapacities: Map<string, number>;
    defaultClassroom: string | null;
  }> {
    const courseTeachers = new Map();
    const classroomCapacities = new Map();

    // Get teacher assignments for courses
    const teacherQuery = `
      SELECT cc.course_id, t.id as teacher_id, t.first_name, t.last_name
      FROM class_courses cc
      JOIN teacher_assignments ta ON cc.id = ta.class_course_id
      JOIN teachers t ON ta.teacher_id = t.id
      WHERE cc.class_id = $1 AND cc.tenant_id = $2
    `;

    const teacherResult = await this.pool.query(teacherQuery, [context.classId, context.tenantId]);

    teacherResult.rows.forEach(row => {
      courseTeachers.set(row.course_id, {
        id: row.teacher_id,
        name: `${row.first_name} ${row.last_name}`,
      });
    });

    // Get classroom capacities
    const classroomQuery = `
      SELECT id, capacity FROM classrooms
      WHERE tenant_id = $1 AND is_active = true
    `;

    const classroomResult = await this.pool.query(classroomQuery, [context.tenantId]);

    classroomResult.rows.forEach(row => {
      classroomCapacities.set(row.id, row.capacity);
    });

    // Get the default classroom for the class
    const classDefaultClassroomQuery = `
      SELECT cr.name as classroom_name
      FROM classes c
      LEFT JOIN classrooms cr ON c.classroom_id = cr.id
      WHERE c.id = $1 AND c.tenant_id = $2
    `;

    const classDefaultResult = await this.pool.query(classDefaultClassroomQuery, [context.classId, context.tenantId]);
    const defaultClassroom = classDefaultResult.rows[0]?.classroom_name || null;

    return {
      ...context,
      courseTeachers,
      classroomCapacities,
      defaultClassroom,
    };
  }

  private async generateSessionCandidates(
    context: GenerationContext & { courseTeachers: Map<string, any> }
  ): Promise<SessionCandidate[]> {
    const candidates: SessionCandidate[] = [];

    // Calculate number of weeks in the period to properly distribute hours
    const startDate = new Date(context.startDate);
    const endDate = new Date(context.startDate);
    endDate.setMonth(endDate.getMonth() + 1); // Default to 1 month if not specified
    const weeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    
    console.log(`📅 Period: ${weeks} weeks from ${context.startDate}`);

    for (const course of context.selectedCourses) {
      const sessionDuration = course.preferredSessionDuration || 120; // 2 hours default
      
      // IMPORTANT: requiredHours is TOTAL for the entire period, not per week
      // We need to divide by number of weeks to get weekly hours
      const hoursPerWeek = course.requiredHours / weeks;
      const sessionsNeeded = Math.ceil((hoursPerWeek * 60) / sessionDuration);

      console.log(`📚 Course requires ${course.requiredHours}h total = ${hoursPerWeek.toFixed(1)}h/week over ${weeks} weeks`);
      console.log(`   → Creating ${sessionsNeeded} sessions/week of ${sessionDuration}min each`);

      // Get course details
      const courseQuery = `
        SELECT name FROM courses WHERE id = $1 AND tenant_id = $2
      `;
      const courseResult = await this.pool.query(courseQuery, [course.courseId, context.tenantId]);
      const courseName = courseResult.rows[0]?.name || 'Unknown Course';

      const teacher = context.courseTeachers.get(course.courseId);

      for (let sessionIndex = 0; sessionIndex < sessionsNeeded; sessionIndex++) {
        for (const timeSlot of context.availableTimeSlots) {
          // Calculate base score based on preferences
          let score = timeSlot.priority * 10;

          // Prefer morning slots if requested
          if (context.generationPreferences.preferMorningSlots) {
            const hour = parseInt(timeSlot.startTime.split(':')[0]);
            if (hour < 12) score += 20;
          }

          // Add some randomness for genetic algorithm
          score += Math.random() * 10;

          candidates.push({
            courseId: course.courseId,
            courseName,
            timeSlotId: timeSlot.id,
            dayOfWeek: timeSlot.dayOfWeek,
            startTime: timeSlot.startTime,
            endTime: timeSlot.endTime,
            durationMinutes: sessionDuration,
            teacherId: teacher?.id,
            score,
          });
        }
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  private async optimizeSchedule(
    candidates: SessionCandidate[],
    context: GenerationContext & { defaultClassroom: string | null }
  ): Promise<ScheduleSession[]> {
    console.log('🔄 Implementing rotation-based schedule generation...');

    const selectedSessions: ScheduleSession[] = [];
    const courseHoursAllocated = new Map<string, number>();
    const courseSessionCounts = new Map<string, number>();
    const usedTimeSlots = new Set<string>(); // Track used time slots to prevent conflicts

    // Calculate weeks in period for proper hour distribution
    const startDate = new Date(context.startDate);
    const endDate = new Date(context.startDate);
    endDate.setMonth(endDate.getMonth() + 1);
    const weeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

    // Calculate hours per week for each course
    const courseHoursPerWeek = new Map<string, number>();
    context.selectedCourses.forEach(course => {
      const hoursPerWeek = course.requiredHours / weeks;
      courseHoursPerWeek.set(course.courseId, hoursPerWeek);
      courseHoursAllocated.set(course.courseId, 0);
      courseSessionCounts.set(course.courseId, 0);
      console.log(`📊 ${course.courseId}: ${course.requiredHours}h total = ${hoursPerWeek.toFixed(1)}h/week`);
    });

    // Sort time slots by day and time for consistent rotation
    const sortedTimeSlots = [...context.availableTimeSlots].sort((a, b) => {
      const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayDiff = dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek);
      if (dayDiff !== 0) return dayDiff;
      return a.startTime.localeCompare(b.startTime);
    });

    const numberOfCourses = context.selectedCourses.length;
    console.log(`📚 Distributing ${numberOfCourses} courses across ${sortedTimeSlots.length} time slots`);

    let slotIndex = 0;

    // Continue until all courses are fully scheduled or no more slots
    while (slotIndex < sortedTimeSlots.length && Array.from(courseHoursAllocated.values()).some(hours => {
      const courseIndex = Array.from(courseHoursAllocated.keys()).indexOf(Array.from(courseHoursAllocated.keys())[Array.from(courseHoursAllocated.values()).indexOf(hours)]);
      const course = context.selectedCourses[courseIndex];
      const targetHours = courseHoursPerWeek.get(course.courseId) || course.requiredHours;
      return course && hours < targetHours;
    })) {

      const timeSlot = sortedTimeSlots[slotIndex];
      const timeSlotKey = `${timeSlot.dayOfWeek}-${timeSlot.startTime}-${timeSlot.endTime}`;

      // Check if this time slot is already used (prevent conflicts)
      if (usedTimeSlots.has(timeSlotKey)) {
        slotIndex++; // Move to next time slot if current one is already used
        continue;
      }

      // Find the next course that needs more hours
      let assignedToSlot = false;
      for (let courseIndex = 0; courseIndex < numberOfCourses; courseIndex++) {
        const course = context.selectedCourses[courseIndex];
        const currentHours = courseHoursAllocated.get(course.courseId) || 0;
        const targetHours = courseHoursPerWeek.get(course.courseId) || course.requiredHours;

        if (currentHours >= targetHours) {
          continue; // Skip this course if it's fully scheduled for the week
        }

        const timeSlot = sortedTimeSlots[slotIndex];

        // Calculate session duration
        const startTime = new Date(`2000-01-01T${timeSlot.startTime}`);
        const endTime = new Date(`2000-01-01T${timeSlot.endTime}`);
        const durationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
        const sessionHours = durationMinutes / 60;

        // Get course name from database
        const courseQuery = `
          SELECT name FROM courses WHERE id = $1 AND tenant_id = $2
        `;
        const courseResult = await this.pool.query(courseQuery, [course.courseId, context.tenantId]);
        const courseName = courseResult.rows[0]?.name || 'Unknown Course';

        // Mark this time slot as used to prevent conflicts
        usedTimeSlots.add(timeSlotKey);

        // Create session
        const sessionCount = courseSessionCounts.get(course.courseId) || 0;
        const session: ScheduleSession = {
          id: `session-${course.courseId}-${sessionCount}`,
          courseId: course.courseId,
          courseName,
          teacherId: context.courseTeachers?.get(course.courseId)?.id,
          teacherName: context.courseTeachers?.get(course.courseId)?.name,
          timeSlotId: timeSlot.id,
          timeSlotName: timeSlot.name,
          dayOfWeek: timeSlot.dayOfWeek,
          startTime: timeSlot.startTime,
          endTime: timeSlot.endTime,
          durationMinutes,
          classroom: this.assignClassroom(context.classroomCapacities, context.defaultClassroom),
          weekPattern: 'weekly',
        };

        selectedSessions.push(session);

        // Update tracking
        courseHoursAllocated.set(course.courseId, currentHours + sessionHours);
        courseSessionCounts.set(course.courseId, sessionCount + 1);

        console.log(`✅ Assigned ${courseName} to ${timeSlot.name} (${sessionHours}h, remaining: ${course.requiredHours - (currentHours + sessionHours)}h)`);

        assignedToSlot = true;
        break; // Exit the course loop since we assigned one course to this slot
      }

      // Move to next time slot regardless of whether we assigned a course or not
      slotIndex++;

      // If no course was assigned to this slot, it means all courses are fully scheduled
      if (!assignedToSlot) {
        break;
      }
    }

    // Log final distribution
    console.log('\n📊 Final course distribution:');
    context.selectedCourses.forEach(course => {
      const allocated = courseHoursAllocated.get(course.courseId) || 0;
      const remaining = course.requiredHours - allocated;
      const sessions = selectedSessions.filter(s => s.courseId === course.courseId).length;
      console.log(`- ${course.courseId}: ${allocated}h scheduled (${sessions} sessions), ${remaining}h remaining`);
    });

    return selectedSessions;
  }

  private assignClassroom(classroomCapacities: Map<string, number>, defaultClassroom?: string | null): string {
    // Use the default classroom for the class if available
    if (defaultClassroom) {
      return defaultClassroom;
    }

    // Fallback to random assignment if no default classroom
    const availableClassrooms = ['Salle A1', 'Salle A2', 'Salle B1', 'Salle B2', 'Lab Info 1', 'Lab Info 2'];
    const randomIndex = Math.floor(Math.random() * availableClassrooms.length);
    return availableClassrooms[randomIndex];
  }

  private detectConflicts(sessions: ScheduleSession[]): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    // Check for time overlaps
    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const session1 = sessions[i];
        const session2 = sessions[j];

        if (session1.dayOfWeek === session2.dayOfWeek) {
          const overlap = this.checkTimeOverlap(
            session1.startTime, session1.endTime,
            session2.startTime, session2.endTime
          );

          if (overlap) {
            conflicts.push({
              type: 'time_overlap',
              description: `Conflit horaire entre ${session1.courseName} et ${session2.courseName} le ${session1.dayOfWeek}`,
              affectedSessions: [session1.id, session2.id],
              severity: 'high',
            });
          }
        }

        // Check teacher conflicts
        if (session1.teacherId && session2.teacherId && 
            session1.teacherId === session2.teacherId &&
            session1.dayOfWeek === session2.dayOfWeek) {
          const overlap = this.checkTimeOverlap(
            session1.startTime, session1.endTime,
            session2.startTime, session2.endTime
          );

          if (overlap) {
            conflicts.push({
              type: 'teacher_conflict',
              description: `Conflit d'enseignant entre ${session1.courseName} et ${session2.courseName}`,
              affectedSessions: [session1.id, session2.id],
              severity: 'critical',
            });
          }
        }
      }
    }

    return conflicts;
  }

  private checkTimeOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
    const s1 = new Date(`1970-01-01T${start1}`);
    const e1 = new Date(`1970-01-01T${end1}`);
    const s2 = new Date(`1970-01-01T${start2}`);
    const e2 = new Date(`1970-01-01T${end2}`);

    return s1 < e2 && s2 < e1;
  }

  private calculateOptimizationScore(
    sessions: ScheduleSession[],
    context: GenerationContext
  ): number {
    let score = 100; // Start with perfect score

    // Penalize for unmet course hours
    context.selectedCourses.forEach(course => {
      const allocatedHours = sessions
        .filter(s => s.courseId === course.courseId)
        .reduce((sum, s) => sum + (s.durationMinutes / 60), 0);

      const shortfall = Math.max(0, course.requiredHours - allocatedHours);
      score -= (shortfall / course.requiredHours) * 30; // Up to 30 points penalty per course
    });

    // Bonus for balanced distribution
    const dailyHours = this.calculateWeeklyDistribution(sessions);
    const hourValues = Object.values(dailyHours);
    const avgHours = hourValues.reduce((sum, h) => sum + h, 0) / hourValues.length;
    const variance = hourValues.reduce((sum, h) => sum + Math.pow(h - avgHours, 2), 0) / hourValues.length;
    
    if (variance < 2) score += 10; // Bonus for balanced distribution

    return Math.max(0, Math.min(100, score));
  }

  private calculateTotalHours(sessions: ScheduleSession[]): number {
    return sessions.reduce((sum, session) => sum + (session.durationMinutes / 60), 0);
  }

  private calculateWeeklyDistribution(sessions: ScheduleSession[]): Record<DayOfWeek, number> {
    const distribution: Record<DayOfWeek, number> = {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0,
    };

    sessions.forEach(session => {
      distribution[session.dayOfWeek] += session.durationMinutes / 60;
    });

    return distribution;
  }
}
