import { z } from "zod";

// ============================================================================
// TYPES DE WIDGETS
// ============================================================================

export const WidgetTypeSchema = z.enum([
  'academic_progress',
  'schedule',
  'assignments',
  'recent_grades',
  'financial_status',
  'messages',
  'announcements',
  'recent_content',
  'course_progress',
  'personal_stats',
  'quick_actions',
  'ai_tutor'
]);

export type WidgetType = z.infer<typeof WidgetTypeSchema>;

// ============================================================================
// SCHEMAS DE BASE MANQUANTS
// ============================================================================

export const DashboardCourseSessionSchema = z.object({
  id: z.string().uuid(),
  courseName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  location: z.string().optional(),
  teacher: z.string().optional()
});

export const DashboardAssignmentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  course: z.string(),
  dueDate: z.string(),
  status: z.enum(['pending', 'submitted', 'graded']),
  grade: z.number().min(0).max(100).optional()
});

export const DashboardGradeSchema = z.object({
  id: z.string().uuid(),
  assignmentTitle: z.string(),
  course: z.string(),
  grade: z.number().min(0).max(100),
  date: z.string(),
  feedback: z.string().optional()
});

export const DashboardFinancialDataSchema = z.object({
  balance: z.number(),
  nextPayment: z.number().optional(),
  nextPaymentDate: z.string().optional(),
  paymentHistory: z.array(z.object({
    amount: z.number(),
    date: z.string(),
    status: z.enum(['paid', 'pending', 'overdue'])
  }))
});

export const DashboardMessageSchema = z.object({
  id: z.string().uuid(),
  from: z.string(),
  subject: z.string(),
  content: z.string(),
  date: z.string(),
  isRead: z.boolean()
});

export const DashboardAnnouncementSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  date: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  category: z.string()
});

export const DashboardContentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: z.enum(['video', 'document', 'assignment']),
  course: z.string(),
  date: z.string(),
  progress: z.number().min(0).max(100).optional()
});

export const DashboardCourseProgressSchema = z.object({
  courseId: z.string().uuid(),
  courseName: z.string(),
  progress: z.number().min(0).max(100),
  completedModules: z.number(),
  totalModules: z.number()
});

export const DashboardStudentStatsSchema = z.object({
  attendanceRate: z.number().min(0).max(100),
  averageGrade: z.number().min(0).max(100),
  completedAssignments: z.number(),
  totalAssignments: z.number()
});

// ============================================================================
// CONFIGURATIONS DES WIDGETS
// ============================================================================

export const AcademicProgressWidgetConfigSchema = z.object({
  showCredits: z.boolean().default(true),
  showGPA: z.boolean().default(true),
  showSemesterProgress: z.boolean().default(true),
  displayMode: z.enum(['chart', 'list', 'circular']).default('circular')
});

export type AcademicProgressWidgetConfig = z.infer<typeof AcademicProgressWidgetConfigSchema>;

export const ScheduleWidgetConfigSchema = z.object({
  view: z.enum(['week', 'day', 'upcoming']).default('week'),
  showLocation: z.boolean().default(true),
  showTeacher: z.boolean().default(true),
  timeRange: z.enum(['08:00-20:00', 'custom']).default('08:00-20:00')
});

export type ScheduleWidgetConfig = z.infer<typeof ScheduleWidgetConfigSchema>;

export const AssignmentsWidgetConfigSchema = z.object({
  filter: z.enum(['urgent', 'all', 'pending']).default('urgent'),
  sortBy: z.enum(['deadline', 'priority', 'course']).default('deadline'),
  showProgress: z.boolean().default(true),
  maxItems: z.number().int().min(1).max(20).default(5)
});

export type AssignmentsWidgetConfig = z.infer<typeof AssignmentsWidgetConfigSchema>;

export const RecentGradesWidgetConfigSchema = z.object({
  period: z.enum(['week', 'month', 'semester']).default('month'),
  showAverage: z.boolean().default(true),
  showTrend: z.boolean().default(true),
  chartType: z.enum(['line', 'bar', 'none']).default('line')
});

export type RecentGradesWidgetConfig = z.infer<typeof RecentGradesWidgetConfigSchema>;

export const FinancialWidgetConfigSchema = z.object({
  showBalance: z.boolean().default(true),
  showNextPayment: z.boolean().default(true),
  showPaymentHistory: z.boolean().default(false),
  alertsEnabled: z.boolean().default(true)
});

export type FinancialWidgetConfig = z.infer<typeof FinancialWidgetConfigSchema>;

export const MessagesWidgetConfigSchema = z.object({
  source: z.enum(['all', 'teachers', 'admin']).default('all'),
  showUnreadOnly: z.boolean().default(false),
  maxItems: z.number().int().min(1).max(20).default(10),
  autoRefresh: z.boolean().default(true)
});

export type MessagesWidgetConfig = z.infer<typeof MessagesWidgetConfigSchema>;

export const AnnouncementsWidgetConfigSchema = z.object({
  category: z.enum(['all', 'academic', 'events', 'urgent']).default('all'),
  showDate: z.boolean().default(true),
  maxItems: z.number().int().min(1).max(20).default(5)
});

export type AnnouncementsWidgetConfig = z.infer<typeof AnnouncementsWidgetConfigSchema>;

export const RecentContentWidgetConfigSchema = z.object({
  contentType: z.enum(['all', 'videos', 'documents', 'assignments']).default('all'),
  showProgress: z.boolean().default(true),
  groupByCourse: z.boolean().default(true)
});

export type RecentContentWidgetConfig = z.infer<typeof RecentContentWidgetConfigSchema>;

export const CourseProgressWidgetConfigSchema = z.object({
  selectedCourses: z.array(z.string().uuid()).default([]),
  displayMode: z.enum(['progress_bars', 'circular', 'list']).default('progress_bars'),
  showDetails: z.boolean().default(false)
});

export type CourseProgressWidgetConfig = z.infer<typeof CourseProgressWidgetConfigSchema>;

export const PersonalStatsWidgetConfigSchema = z.object({
  showAttendance: z.boolean().default(true),
  showGrades: z.boolean().default(true),
  showAssignments: z.boolean().default(true),
  chartType: z.enum(['line', 'bar', 'radar']).default('line')
});

export type PersonalStatsWidgetConfig = z.infer<typeof PersonalStatsWidgetConfigSchema>;

export const QuickActionsWidgetConfigSchema = z.object({
  showFavorites: z.boolean().default(true),
  showRecent: z.boolean().default(true),
  maxActions: z.number().int().min(1).max(10).default(6),
  customActions: z.array(z.object({
    label: z.string(),
    action: z.string(),
    icon: z.string().optional()
  })).default([])
});

export type QuickActionsWidgetConfig = z.infer<typeof QuickActionsWidgetConfigSchema>;

export const AITutorWidgetConfigSchema = z.object({
  showSuggestions: z.boolean().default(true),
  showHistory: z.boolean().default(true),
  maxSuggestions: z.number().int().min(1).max(5).default(3),
  autoSuggest: z.boolean().default(true)
});

export type AITutorWidgetConfig = z.infer<typeof AITutorWidgetConfigSchema>;

// ============================================================================
// UNION DES CONFIGURATIONS
// ============================================================================

export const WidgetConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('academic_progress'), config: AcademicProgressWidgetConfigSchema }),
  z.object({ type: z.literal('schedule'), config: ScheduleWidgetConfigSchema }),
  z.object({ type: z.literal('assignments'), config: AssignmentsWidgetConfigSchema }),
  z.object({ type: z.literal('recent_grades'), config: RecentGradesWidgetConfigSchema }),
  z.object({ type: z.literal('financial_status'), config: FinancialWidgetConfigSchema }),
  z.object({ type: z.literal('messages'), config: MessagesWidgetConfigSchema }),
  z.object({ type: z.literal('announcements'), config: AnnouncementsWidgetConfigSchema }),
  z.object({ type: z.literal('recent_content'), config: RecentContentWidgetConfigSchema }),
  z.object({ type: z.literal('course_progress'), config: CourseProgressWidgetConfigSchema }),
  z.object({ type: z.literal('personal_stats'), config: PersonalStatsWidgetConfigSchema }),
  z.object({ type: z.literal('quick_actions'), config: QuickActionsWidgetConfigSchema }),
  z.object({ type: z.literal('ai_tutor'), config: AITutorWidgetConfigSchema })
]);

export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// ============================================================================
// DONNÉES DES WIDGETS
// ============================================================================

export const AIRecommendationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['study_tip', 'resource', 'reminder']),
  title: z.string(),
  description: z.string(),
  actionable: z.boolean(),
  actionLabel: z.string().optional()
});

export type AIRecommendation = z.infer<typeof AIRecommendationSchema>;

export const AIInteractionSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  answer: z.string(),
  date: z.string(),
  helpful: z.boolean().optional()
});

export type AIInteraction = z.infer<typeof AIInteractionSchema>;

export const AITutorDataSchema = z.object({
  recommendations: z.array(AIRecommendationSchema),
  recentInteractions: z.array(AIInteractionSchema)
});

export type AITutorData = z.infer<typeof AITutorDataSchema>;

// ============================================================================
// UNION DES DONNÉES
// ============================================================================

export const WidgetDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('academic_progress'), data: z.object({
    totalCredits: z.number().int().min(0),
    acquiredCredits: z.number().int().min(0),
    currentGPA: z.number().min(0).max(4),
    semesterProgress: z.number().min(0).max(100)
  }) }),
  z.object({ type: z.literal('schedule'), data: z.array(DashboardCourseSessionSchema) }),
  z.object({ type: z.literal('assignments'), data: z.array(DashboardAssignmentSchema) }),
  z.object({ type: z.literal('recent_grades'), data: z.array(DashboardGradeSchema) }),
  z.object({ type: z.literal('financial_status'), data: DashboardFinancialDataSchema }),
  z.object({ type: z.literal('messages'), data: z.array(DashboardMessageSchema) }),
  z.object({ type: z.literal('announcements'), data: z.array(DashboardAnnouncementSchema) }),
  z.object({ type: z.literal('recent_content'), data: z.array(DashboardContentSchema) }),
  z.object({ type: z.literal('course_progress'), data: z.array(DashboardCourseProgressSchema) }),
  z.object({ type: z.literal('personal_stats'), data: DashboardStudentStatsSchema }),
  z.object({ type: z.literal('quick_actions'), data: z.object({}) }),
  z.object({ type: z.literal('ai_tutor'), data: AITutorDataSchema })
]);

export type WidgetData = z.infer<typeof WidgetDataSchema>;

// ============================================================================
// INSTANCE DE WIDGET
// ============================================================================

export const WidgetInstanceSchema = z.object({
  id: z.string().uuid(),
  type: WidgetTypeSchema,
  position: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(8)
  }),
  config: WidgetConfigSchema,
  isResizable: z.boolean().default(true),
  isDraggable: z.boolean().default(true)
});

export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;

// ============================================================================
// LAYOUT DU TABLEAU DE BORD
// ============================================================================

export const DashboardLayoutSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100),
  widgets: z.array(WidgetInstanceSchema),
  gridConfig: z.object({
    columns: z.number().int().min(1).max(12).default(12),
    rowHeight: z.number().int().min(20).max(200).default(100),
    margin: z.tuple([z.number(), z.number()]).default([10, 10])
  }),
  isActive: z.boolean().default(true)
});

export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;

// ============================================================================
// CONFIGURATION DU TABLEAU DE BORD
// ============================================================================

export const StudentDashboardConfigSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  layoutName: z.string().max(100),
  isActive: z.boolean().default(true),
  configData: z.record(z.any()).default({}),
  createdAt: z.date(),
  updatedAt: z.date()
});

export type StudentDashboardConfig = z.infer<typeof StudentDashboardConfigSchema>;

// ============================================================================
// TEMPLATE DE TABLEAU DE BORD
// ============================================================================

export const DashboardTemplateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().max(100),
  description: z.string().optional(),
  layoutConfig: DashboardLayoutSchema,
  isDefault: z.boolean().default(false),
  createdAt: z.date()
});

export type DashboardTemplate = z.infer<typeof DashboardTemplateSchema>;

// ============================================================================
// WIDGETS DISPONIBLES
// ============================================================================

export const DashboardWidgetSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  widgetType: WidgetTypeSchema,
  widgetName: z.string().max(100),
  description: z.string().optional(),
  defaultConfig: WidgetConfigSchema,
  isEnabled: z.boolean().default(true),
  createdAt: z.date()
});

export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

// ============================================================================
// SCHEMAS DE CRÉATION ET MISE À JOUR
// ============================================================================

export const CreateDashboardLayoutSchema = DashboardLayoutSchema.omit({
  id: true
});

export const UpdateDashboardLayoutSchema = CreateDashboardLayoutSchema.partial();

export const CreateStudentDashboardConfigSchema = StudentDashboardConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const UpdateStudentDashboardConfigSchema = CreateStudentDashboardConfigSchema.partial();

export const CreateDashboardTemplateSchema = DashboardTemplateSchema.omit({
  id: true,
  createdAt: true
});

export const UpdateDashboardTemplateSchema = CreateDashboardTemplateSchema.partial();

export const CreateDashboardWidgetSchema = DashboardWidgetSchema.omit({
  id: true,
  createdAt: true
});

export const UpdateDashboardWidgetSchema = CreateDashboardWidgetSchema.partial();

// ============================================================================
// SCHEMAS DE REQUÊTE
// ============================================================================

export const DashboardQuerySchema = z.object({
  layoutName: z.string().optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20)
});

export const WidgetDataQuerySchema = z.object({
  widgetType: WidgetTypeSchema,
  refresh: z.boolean().optional(),
  period: z.string().optional()
});

// ============================================================================
// RÉPONSES API
// ============================================================================

export const DashboardListResponseSchema = z.object({
  dashboards: z.array(StudentDashboardConfigSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalPages: z.number().int().min(0)
});

export const WidgetDataResponseSchema = z.object({
  widgetType: WidgetTypeSchema,
  data: WidgetDataSchema,
  lastUpdated: z.string(),
  nextUpdate: z.string().optional()
});

export const AvailableWidgetsResponseSchema = z.object({
  widgets: z.array(DashboardWidgetSchema),
  total: z.number().int().min(0)
});



