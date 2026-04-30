import { z } from "zod";

// Child List Item Schema
export const ChildListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  currentYear: z.number().int().min(1).max(10),
  status: z.enum(['active', 'suspended', 'dropped', 'transfer', 'graduated']),
  studentNumber: z.string(),
  summaryIndicator: z.object({
    gradeAverage: z.number().nullable(),
    attendanceStatus: z.enum(['good', 'warning']).nullable(),
  }),
});

// Child Detail Schema
export const ChildDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  currentYear: z.number().int().min(1).max(10),
  status: z.enum(['active', 'suspended', 'dropped', 'transfer', 'graduated']),
  studentNumber: z.string(),
  dateOfBirth: z.string().nullable(),
  phone: z.string().nullable(),
});

// Grades Summary Schema
export const GradesSummarySchema = z.object({
  averageGrade: z.number(),
  totalAssignments: z.number(),
  gradedAssignments: z.number(),
  bestScore: z.number(),
  gradeDistribution: z.object({
    excellent: z.number(), // >= 16
    good: z.number(),      // 14-15
    average: z.number(),   // 12-13
    belowAverage: z.number() // < 12
  }),
});

// Schedule Session Schema (parent portal — distinct from schedule-generation)
export const ParentScheduleSessionSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  courseName: z.string(),
  courseCode: z.string(),
  classroom: z.string().nullable(),
  teacherName: z.string().nullable(),
});

// Attendance Record Schema
export const AttendanceRecordSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  courseName: z.string(),
  courseCode: z.string(),
  status: z.enum(['present', 'absent', 'late', 'excused', 'medical_leave']),
  arrivalTime: z.string().nullable(),
  departureTime: z.string().nullable(),
  excuseReason: z.string().nullable(),
  notes: z.string().nullable(),
  markedAt: z.string(),
});

// Absence Record Schema
export const AbsenceRecordSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  courseName: z.string(),
  courseCode: z.string(),
  absenceType: z.enum(['absent', 'excused', 'medical_leave']),
  excuseReason: z.string().nullable(),
  markedAt: z.string(),
});

// Absence Statistics Schema
export const AbsenceStatisticsSchema = z.object({
  totalAbsences: z.number(),
  excusedCount: z.number(),
  unexcusedCount: z.number(),
  medicalCount: z.number(),
  absenceRate: z.number(),
});

// Parent Assignment Schema
export const ParentAssignmentSchema = z.object({
  id: z.string().uuid(), // instance_id
  assignmentId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  courseId: z.string().uuid(),
  courseName: z.string(),
  courseCode: z.string().nullable(),
  childId: z.string().uuid(),
  childName: z.string(),
  dueDate: z.string(), // ISO date string
  daysRemaining: z.number().int(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'submitted', 'expired', 'graded']),
  submissionType: z.enum(['evaluation', 'homework']),
  maxPoints: z.number(),
  submittedAt: z.string().nullable(),
  grade: z.number().nullable(),
  feedback: z.string().nullable(),
});

// Parent Assignment List Schema
export const ParentAssignmentListSchema = z.object({
  assignments: z.array(ParentAssignmentSchema),
  total: z.number(),
});

// Course Material Schema (parent portal — distinct from materials module)
export const ParentCourseMaterialSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  fileUrl: z.string(),
  courseId: z.string().uuid(),
  courseName: z.string(),
  courseCode: z.string().nullable(),
  uploadedAt: z.string(), // ISO date string
  uploadedBy: z.string().nullable(),
});

// Homework workflow status (parent portal — distinct from teacher `AssignmentStatusSchema`)
export const ParentHomeworkAssignmentStatusSchema = z.enum([
  'pending',
  'in_progress',
  'submitted',
  'expired',
  'graded',
]);

// Assignment Filter Schema
export const AssignmentFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  status: ParentHomeworkAssignmentStatusSchema.optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
});

// Parent Grade Schema
export const ParentGradeSchema = z.object({
  id: z.string().uuid(), // submission_id
  assignmentId: z.string().uuid(),
  assignmentName: z.string(),
  courseId: z.string().uuid(),
  courseName: z.string(),
  courseCode: z.string().nullable(),
  childId: z.string().uuid(),
  childName: z.string(),
  grade: z.number(),
  maxPoints: z.number(),
  percentage: z.number(),
  feedback: z.string().nullable(),
  submittedAt: z.string().nullable(), // ISO date string
  gradedAt: z.string().nullable(), // ISO date string
  dueDate: z.string().nullable(), // ISO date string
});

// Parent Grade List Schema
export const ParentGradeListSchema = z.object({
  grades: z.array(ParentGradeSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// Course Grade Summary Schema
export const CourseGradeSummarySchema = z.object({
  courseId: z.string().uuid(),
  courseName: z.string(),
  courseCode: z.string().nullable(),
  childId: z.string().uuid(),
  childName: z.string(),
  assignmentGrades: z.array(
    z.object({
      id: z.string().uuid(),
      assignmentId: z.string().uuid(),
      assignmentName: z.string(),
      grade: z.number(),
      maxPoints: z.number(),
      percentage: z.number(),
      gradedAt: z.string().nullable(),
    })
  ),
  courseAverage: z.number(),
  totalGraded: z.number(),
});

// Overall Grade Statistics Schema
export const OverallGradeStatisticsSchema = z.object({
  overallAverage: z.number(),
  totalGraded: z.number(),
  gradeDistribution: z.object({
    excellent: z.number(), // >= 16
    good: z.number(),      // 14-15
    average: z.number(),   // 12-13
    belowAverage: z.number() // < 12
  }),
  bestScore: z.number(),
  worstScore: z.number(),
});

// Grade Trend Data Schema
export const GradeTrendDataSchema = z.object({
  periodStart: z.string(), // ISO date string
  periodEnd: z.string(), // ISO date string
  periodLabel: z.string(),
  averageGrade: z.number(),
  gradeCount: z.number(),
});

// Grade Filter Schema
export const GradeFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  semester: z.string().optional(),
  period: z.enum(['week', 'month', 'semester']).optional(),
});

// Parent Payment Transaction Schema
export const ParentPaymentTransactionSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  enrollmentId: z.string().uuid(),
  tuitionInstallmentId: z.string().uuid().nullable(),
  feeType: z.enum(['tuition', 'inscription', 'annexes', 'autres']),
  amount: z.number(),
  currency: z.string(),
  paymentMethod: z.string(),
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  receiptUrl: z.string().nullable(),
  processedAt: z.string().nullable(), // ISO date string
  createdAt: z.string(), // ISO date string
});

// Parent Payment History Schema
export const ParentPaymentHistorySchema = z.object({
  transactions: z.array(ParentPaymentTransactionSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// Tuition Installment Schema
export const TuitionInstallmentSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  enrollmentId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  installmentNumber: z.number().int(),
  installmentLabel: z.string(),
  amount: z.number(),
  dueDate: z.string(), // ISO date string
  status: z.enum(['pending', 'paid', 'overdue', 'partial']),
  amountPaid: z.number(),
  lateFee: z.number(),
});

// Payment Schedule Schema
export const PaymentScheduleSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  enrollmentId: z.string().uuid(),
  scheduleName: z.string(),
  academicYear: z.string(),
  totalTuition: z.number(),
  numberOfInstallments: z.number().int(),
  installmentPercentage: z.record(z.number()).optional(),
  installments: z.array(TuitionInstallmentSchema).optional(),
});

// Outstanding Balance Schema
export const OutstandingBalanceSchema = z.object({
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  feeType: z.enum(['tuition', 'inscription', 'annexes', 'autres']),
  totalOutstanding: z.number(),
  amountPaid: z.number(),
  amountDue: z.number(),
});

// Payment Receipt Schema
export const PaymentReceiptSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  receiptNumber: z.string(),
  receiptUrl: z.string(),
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  feeType: z.enum(['tuition', 'inscription', 'annexes', 'autres']),
  amount: z.number(),
  paymentMethod: z.string(),
  processedAt: z.string().nullable(), // ISO date string
  generatedAt: z.string(), // ISO date string
});

// Payment Method Schema
export const PaymentMethodSchema = z.object({
  id: z.string().uuid(),
  methodType: z.string(),
  last4Digits: z.string().nullable(),
  expirationDate: z.string().nullable(), // ISO date string
  isDefault: z.boolean(),
});

// Payment Filter Schema
export const PaymentFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  feeType: z.enum(['tuition', 'inscription', 'annexes', 'autres']).optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']).optional(),
});

// Teacher Message Schema
export const TeacherMessageSchema = z.object({
  id: z.string().uuid(),
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  parentId: z.string().uuid(),
  subject: z.string(),
  content: z.string(),
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  sentAt: z.string(), // ISO date string
  readAt: z.string().nullable(), // ISO date string
  isRead: z.boolean(),
});

// School Announcement Schema
export const SchoolAnnouncementSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  title: z.string(),
  content: z.string(),
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  postedAt: z.string(), // ISO date string
  readAt: z.string().nullable(), // ISO date string
  isRead: z.boolean(),
});

// Conversation Message Schema
export const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string(),
  content: z.string(),
  sentAt: z.string(), // ISO date string
  readAt: z.string().nullable(), // ISO date string
  isRead: z.boolean(),
});

// Parent-Teacher Conversation Schema
export const ParentTeacherConversationSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid(),
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  studentId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  subject: z.string(),
  status: z.enum(['active', 'archived', 'closed']),
  lastMessagePreview: z.string().nullable(),
  lastMessageDate: z.string(), // ISO date string
  unreadCount: z.number().int(),
  createdAt: z.string(), // ISO date string
  updatedAt: z.string(), // ISO date string
});

// Notification Schema
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid(),
  notificationType: z.enum(['message', 'announcement', 'event', 'grade', 'payment', 'other']),
  title: z.string(),
  content: z.string(),
  actionLink: z.string().nullable(),
  readAt: z.string().nullable(), // ISO date string
  isRead: z.boolean(),
  createdAt: z.string(), // ISO date string
});

// Event Invitation Schema
export const EventInvitationSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid().nullable(),
  parentId: z.string().uuid(),
  studentId: z.string().uuid().nullable(),
  childId: z.string().uuid().nullable(),
  childName: z.string().nullable(),
  eventName: z.string(),
  eventDescription: z.string(),
  eventDate: z.string(), // ISO date string
  eventLocation: z.string().nullable(),
  organizerId: z.string().uuid(),
  organizerName: z.string(),
  rsvpStatus: z.enum(['pending', 'accepted', 'declined', 'tentative']),
  rsvpDeadline: z.string().nullable(), // ISO date string
  rsvpResponseAt: z.string().nullable(), // ISO date string
  createdAt: z.string(), // ISO date string
  updatedAt: z.string(), // ISO date string
});

// Message Filter Schema
export const MessageFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  readStatus: z.enum(['read', 'unread', 'all']).optional(),
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

// Notification Filter Schema
export const NotificationFilterSchema = z.object({
  notificationType: z.enum(['message', 'announcement', 'event', 'grade', 'payment', 'other']).optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  readStatus: z.enum(['read', 'unread', 'all']).optional(),
});

// Announcement Filter Schema
export const AnnouncementFilterSchema = z.object({
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  priorityLevel: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  readStatus: z.enum(['read', 'unread', 'all']).optional(),
});

// Conversation Filter Schema
export const ConversationFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  status: z.enum(['active', 'archived', 'closed']).optional(),
});

// Invitation Filter Schema
export const InvitationFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  rsvpStatus: z.enum(['pending', 'accepted', 'declined', 'tentative']).optional(),
});

// Type exports
export type ChildListItem = z.infer<typeof ChildListItemSchema>;
export type ChildDetail = z.infer<typeof ChildDetailSchema>;
export type GradesSummary = z.infer<typeof GradesSummarySchema>;
export type ParentScheduleSession = z.infer<typeof ParentScheduleSessionSchema>;
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;
export type AbsenceRecord = z.infer<typeof AbsenceRecordSchema>;
export type AbsenceStatistics = z.infer<typeof AbsenceStatisticsSchema>;
export type ParentAssignment = z.infer<typeof ParentAssignmentSchema>;
export type ParentAssignmentList = z.infer<typeof ParentAssignmentListSchema>;
export type ParentCourseMaterial = z.infer<typeof ParentCourseMaterialSchema>;
export type ParentHomeworkAssignmentStatus = z.infer<typeof ParentHomeworkAssignmentStatusSchema>;
export type AssignmentFilter = z.infer<typeof AssignmentFilterSchema>;
export type ParentGrade = z.infer<typeof ParentGradeSchema>;
export type ParentGradeList = z.infer<typeof ParentGradeListSchema>;
export type CourseGradeSummary = z.infer<typeof CourseGradeSummarySchema>;
export type OverallGradeStatistics = z.infer<typeof OverallGradeStatisticsSchema>;
export type GradeTrendData = z.infer<typeof GradeTrendDataSchema>;
export type GradeFilter = z.infer<typeof GradeFilterSchema>;
export type ParentPaymentTransaction = z.infer<typeof ParentPaymentTransactionSchema>;
export type ParentPaymentHistory = z.infer<typeof ParentPaymentHistorySchema>;
export type TuitionInstallment = z.infer<typeof TuitionInstallmentSchema>;
export type PaymentSchedule = z.infer<typeof PaymentScheduleSchema>;
export type OutstandingBalance = z.infer<typeof OutstandingBalanceSchema>;
export type PaymentReceipt = z.infer<typeof PaymentReceiptSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type PaymentFilter = z.infer<typeof PaymentFilterSchema>;
export type TeacherMessage = z.infer<typeof TeacherMessageSchema>;
export type SchoolAnnouncement = z.infer<typeof SchoolAnnouncementSchema>;
export type ParentTeacherConversation = z.infer<typeof ParentTeacherConversationSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type EventInvitation = z.infer<typeof EventInvitationSchema>;
export type MessageFilter = z.infer<typeof MessageFilterSchema>;
export type AnnouncementFilter = z.infer<typeof AnnouncementFilterSchema>;
export type ConversationFilter = z.infer<typeof ConversationFilterSchema>;
export type NotificationFilter = z.infer<typeof NotificationFilterSchema>;
export type InvitationFilter = z.infer<typeof InvitationFilterSchema>;

// Parent Profile Schema
export const ParentProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  dateOfBirth: z.string().nullable(), // ISO date string
  profilePictureUrl: z.string().nullable(),
  createdAt: z.string(), // ISO date string
  updatedAt: z.string(), // ISO date string
});

// Contact Information Schema
export const ContactInformationSchema = z.object({
  phone: z.string().nullable(),
  email: z.string().email(),
  address: z.string().nullable(),
});

// Emergency Contact Schema
export const EmergencyContactSchema = z.object({
  id: z.string().uuid(),
  contactName: z.string(),
  relationship: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  createdAt: z.string(), // ISO date string
  updatedAt: z.string(), // ISO date string
});

// Notification Preference Schema
export const NotificationPreferenceSchema = z.object({
  id: z.string().uuid(),
  notificationType: z.enum(['message', 'announcement', 'event', 'grade', 'payment', 'other']),
  enabled: z.boolean(),
  deliveryMethods: z.array(z.enum(['email', 'in-app', 'sms'])),
  createdAt: z.string(), // ISO date string
  updatedAt: z.string(), // ISO date string
});

// Parent-Child Relationship Schema
export const ParentChildRelationshipSchema = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  relationshipType: z.enum(['parent', 'guardian', 'emergency_contact']),
  isPrimaryContact: z.boolean(),
  emergencyContact: z.boolean(),
  canPickup: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(), // ISO date string
});

// Profile Update Schema
export const ProfileUpdateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(), // ISO date string
});

// Contact Update Schema
export const ContactUpdateSchema = z.object({
  phone: z.string().nullable().optional(),
  email: z.string().email(),
  address: z.string().nullable().optional(),
});

// Emergency Contact Create Schema
export const EmergencyContactCreateSchema = z.object({
  contactName: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().nullable().optional(),
});

// Emergency Contact Update Schema
export const EmergencyContactUpdateSchema = z.object({
  contactName: z.string().min(1).optional(),
  relationship: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
});

// Notification Preferences Update Schema
export const NotificationPreferencesUpdateSchema = z.object({
  preferences: z.array(
    z.object({
      notificationType: z.enum(['message', 'announcement', 'event', 'grade', 'payment', 'other']),
      enabled: z.boolean(),
      deliveryMethods: z.array(z.enum(['email', 'in-app', 'sms'])),
    })
  ),
});

// Password Change Schema
export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(8),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// Pickup Authorization Schema
export const PickupAuthorizationSchema = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  relationshipType: z.enum(['parent', 'guardian', 'emergency_contact']),
  canPickup: z.boolean(),
  createdAt: z.string(), // ISO date string
});

// Relationship Type Schema
export const RelationshipTypeSchema = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  relationshipType: z.enum(['parent', 'guardian', 'emergency_contact']),
  isPrimaryContact: z.boolean(),
  emergencyContact: z.boolean(),
  canPickup: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(), // ISO date string
});

// Data Access Schema
export const DataAccessSchema = z.object({
  relationshipId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  relationshipType: z.enum(['parent', 'guardian', 'emergency_contact']),
  canPickup: z.boolean(),
  accessLevel: z.enum(['full', 'limited', 'view-only']),
  accessibleDataTypes: z.array(z.string()),
});

// Pickup Authorization Update Schema
export const PickupAuthorizationUpdateSchema = z.object({
  canPickup: z.boolean(),
});

// Relationship Type Update Schema
export const RelationshipTypeUpdateSchema = z.object({
  relationshipType: z.enum(['parent', 'guardian', 'emergency_contact']),
});

// Type exports
export type ParentProfile = z.infer<typeof ParentProfileSchema>;
export type ContactInformation = z.infer<typeof ContactInformationSchema>;
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;
export type ParentChildRelationship = z.infer<typeof ParentChildRelationshipSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
export type ContactUpdate = z.infer<typeof ContactUpdateSchema>;
export type EmergencyContactCreate = z.infer<typeof EmergencyContactCreateSchema>;
export type EmergencyContactUpdate = z.infer<typeof EmergencyContactUpdateSchema>;
export type NotificationPreferencesUpdate = z.infer<typeof NotificationPreferencesUpdateSchema>;
export type PasswordChange = z.infer<typeof PasswordChangeSchema>;
export type PickupAuthorization = z.infer<typeof PickupAuthorizationSchema>;
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;
export type DataAccess = z.infer<typeof DataAccessSchema>;
export type PickupAuthorizationUpdate = z.infer<typeof PickupAuthorizationUpdateSchema>;
export type RelationshipTypeUpdate = z.infer<typeof RelationshipTypeUpdateSchema>;

// Parent Academic Information Schemas

// Enrolled Course Schema
export const EnrolledCourseSchema = z.object({
  courseId: z.string().uuid(),
  courseName: z.string(),
  courseCode: z.string(),
  childId: z.string().uuid(),
  childName: z.string(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string().nullable(),
  scheduleDay: z.number().int().min(1).max(7).nullable(),
  scheduleTime: z.string().nullable(),
  classroom: z.string().nullable(),
  deliveryMode: z.enum(['presential', 'remote', 'hybrid', 'elearning']),
  courseStatus: z.enum(['draft', 'active', 'inactive']),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
});

// Academic Course Material Schema (for academic information)
export const AcademicCourseMaterialSchema = z.object({
  materialId: z.string().uuid(),
  materialName: z.string(),
  materialType: z.enum(['document', 'video', 'link', 'other']),
  courseId: z.string().uuid(),
  courseName: z.string(),
  childId: z.string().uuid(),
  childName: z.string(),
  uploadDate: z.string(), // ISO date string
  fileSize: z.number().int().nullable(),
  fileUrl: z.string().nullable(),
  downloadable: z.boolean(),
  viewable: z.boolean(),
});

// Academic Calendar Event Schema
export const AcademicCalendarEventSchema = z.object({
  eventId: z.string().uuid(),
  eventName: z.string(),
  eventType: z.enum(['semester_start', 'semester_end', 'holiday', 'break', 'special_event', 'academic_milestone']),
  eventDate: z.string(), // ISO date string
  eventDescription: z.string().nullable(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  semester: z.number().int().nullable(),
});

// Exam Schedule Schema
export const ExamScheduleSchema = z.object({
  examId: z.string().uuid(),
  examName: z.string(),
  examType: z.enum(['midterm', 'final', 'quiz', 'assignment', 'other']),
  courseId: z.string().uuid(),
  courseName: z.string(),
  childId: z.string().uuid(),
  childName: z.string(),
  examDate: z.string().nullable(), // ISO date string
  examTime: z.string().nullable(), // HH:MM format
  duration: z.number().int().nullable(), // Duration in minutes
  location: z.string().nullable(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
});

// Academic Year Information Schema
export const AcademicYearInfoSchema = z.object({
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  startDate: z.string(), // ISO date string
  endDate: z.string(), // ISO date string
  isCurrent: z.boolean(),
  semesterInfo: z.object({
    semester1: z.object({
      startDate: z.string(), // ISO date string
      endDate: z.string(), // ISO date string
    }).optional(),
    semester2: z.object({
      startDate: z.string(), // ISO date string
      endDate: z.string(), // ISO date string
    }).optional(),
  }).nullable(),
  enrollmentDetails: z.array(z.object({
    childId: z.string().uuid(),
    childName: z.string(),
    enrollmentDate: z.string(), // ISO date string
    status: z.enum(['active', 'graduated', 'suspended', 'dropped', 'transfer']),
  })),
  academicMilestones: z.array(z.object({
    name: z.string(),
    date: z.string(), // ISO date string
    description: z.string().nullable(),
  })).nullable(),
});

// Filter Schemas

// Enrolled Course Filter Schema
export const EnrolledCourseFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});

// Academic Course Material Filter Schema
export const AcademicCourseMaterialFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  materialType: z.enum(['document', 'video', 'link', 'other']).optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
});

// Academic Calendar Filter Schema
export const AcademicCalendarFilterSchema = z.object({
  academicYearId: z.string().uuid().optional(),
  semester: z.number().int().optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
});

// Exam Schedule Filter Schema
export const ExamScheduleFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  examType: z.enum(['midterm', 'final', 'quiz', 'other']).optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
  academicYearId: z.string().uuid().optional(),
});

// Academic Year Filter Schema
export const AcademicYearFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});

// Type exports
export type EnrolledCourse = z.infer<typeof EnrolledCourseSchema>;
export type AcademicCourseMaterial = z.infer<typeof AcademicCourseMaterialSchema>;
export type AcademicCalendarEvent = z.infer<typeof AcademicCalendarEventSchema>;
export type ExamSchedule = z.infer<typeof ExamScheduleSchema>;
export type AcademicYearInfo = z.infer<typeof AcademicYearInfoSchema>;
export type EnrolledCourseFilter = z.infer<typeof EnrolledCourseFilterSchema>;
export type AcademicCourseMaterialFilter = z.infer<typeof AcademicCourseMaterialFilterSchema>;
export type AcademicCalendarFilter = z.infer<typeof AcademicCalendarFilterSchema>;
export type ExamScheduleFilter = z.infer<typeof ExamScheduleFilterSchema>;
export type AcademicYearFilter = z.infer<typeof AcademicYearFilterSchema>;

// Parent Documents Schemas

// Report Card Schema
export const ReportCardSchema = z.object({
  reportCardId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  semester: z.number().int(),
  reportDate: z.string(), // ISO date string
  overallGrade: z.number(),
  reportUrl: z.string(),
  downloadable: z.boolean(),
  viewable: z.boolean(),
});

// Transcript Schema
export const TranscriptSchema = z.object({
  transcriptId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  transcriptDate: z.string(), // ISO date string
  totalCredits: z.number().int(),
  gpa: z.number(),
  transcriptUrl: z.string(),
  downloadable: z.boolean(),
  viewable: z.boolean(),
});

// Attendance Report Schema
export const AttendanceReportSchema = z.object({
  reportId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  reportPeriod: z.string(),
  reportDate: z.string(), // ISO date string
  attendanceRate: z.number(),
  totalDays: z.number().int(),
  presentDays: z.number().int(),
  absentDays: z.number().int(),
  reportUrl: z.string(),
  downloadable: z.boolean(),
  viewable: z.boolean(),
});

// Payment Receipt Schema (for documents feature)
export const PaymentReceiptDocumentSchema = z.object({
  receiptId: z.string().uuid(),
  childId: z.string().uuid(),
  childName: z.string(),
  receiptNumber: z.string(),
  paymentDate: z.string(), // ISO date string
  amount: z.number(),
  currency: z.string(),
  paymentMethod: z.string(),
  feeType: z.enum(['tuition', 'inscription', 'annexes', 'autres']),
  academicYearId: z.string().uuid(),
  academicYearName: z.string(),
  receiptUrl: z.string(),
  downloadable: z.boolean(),
  viewable: z.boolean(),
});

// Filter Schemas

// Report Card Filter Schema
export const ReportCardFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  semester: z.number().int().optional(),
});

// Transcript Filter Schema
export const TranscriptFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});

// Attendance Report Filter Schema
export const AttendanceReportFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
});

// Payment Receipt Filter Schema
export const PaymentReceiptFilterSchema = z.object({
  childId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  startDate: z.string().optional(), // ISO date string
  endDate: z.string().optional(), // ISO date string
});

// Type exports
export type ReportCard = z.infer<typeof ReportCardSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type AttendanceReport = z.infer<typeof AttendanceReportSchema>;
export type PaymentReceiptDocument = z.infer<typeof PaymentReceiptDocumentSchema>;
export type ReportCardFilter = z.infer<typeof ReportCardFilterSchema>;
export type TranscriptFilter = z.infer<typeof TranscriptFilterSchema>;
export type AttendanceReportFilter = z.infer<typeof AttendanceReportFilterSchema>;
export type PaymentReceiptFilter = z.infer<typeof PaymentReceiptFilterSchema>;

