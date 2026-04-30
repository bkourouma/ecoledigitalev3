import { z } from "zod";

// Supported file types for course materials
export const SUPPORTED_FILE_TYPES = {
  // Documents
  PDF: 'application/pdf',
  POWERPOINT: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  POWERPOINT_LEGACY: 'application/vnd.ms-powerpoint',
  
  // Images
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  GIF: 'image/gif',
  WEBP: 'image/webp',
  
  // Videos
  MP4: 'video/mp4',
  WEBM: 'video/webm',
  AVI: 'video/avi',
  MOV: 'video/quicktime',
} as const;

export const SUPPORTED_FILE_EXTENSIONS = [
  '.pdf',
  '.pptx', '.ppt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.webm', '.avi', '.mov'
] as const;

// File size limits (in bytes)
export const FILE_SIZE_LIMITS = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,  // 10MB
  MAX_VIDEO_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_DOCUMENT_SIZE: 50 * 1024 * 1024, // 50MB
} as const;

// Processing status enum
export const MaterialProcessingStatusSchema = z.enum([
  'pending',
  'processing', 
  'completed',
  'failed'
]);

export type MaterialProcessingStatus = z.infer<typeof MaterialProcessingStatusSchema>;

// Base material schema
export const CourseMaterialSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  courseId: z.string().uuid(),
  title: z.string().min(1).max(255),
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(100),
  fileSize: z.number().positive(),
  minioKey: z.string().min(1).max(500),
  contentText: z.string().nullable(),
  embedding: z.array(z.number()).nullable(), // Vector embedding
  uploadedBy: z.string().uuid(),
  processingStatus: MaterialProcessingStatusSchema,
  processingError: z.string().nullable(),
  processedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CourseMaterial = z.infer<typeof CourseMaterialSchema>;

// Create material schema (for uploads)
export const CreateCourseMaterialSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(255),
  // File will be handled separately in multipart form
});

export type CreateCourseMaterial = z.infer<typeof CreateCourseMaterialSchema>;

// Update material schema
export const UpdateCourseMaterialSchema = z.object({
  title: z.string().min(1).max(255).optional(),
});

export type UpdateCourseMaterial = z.infer<typeof UpdateCourseMaterialSchema>;

// Query schema for listing materials
export const MaterialQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  fileType: z.string().optional(),
  processingStatus: MaterialProcessingStatusSchema.optional(),
  search: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'title', 'fileSize']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type MaterialQuery = z.infer<typeof MaterialQuerySchema>;

// Material with additional metadata for frontend
export const MaterialWithMetadataSchema = CourseMaterialSchema.extend({
  uploadedByName: z.string(),
  courseName: z.string(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  viewerUrl: z.string().optional(),
  downloadUrl: z.string().optional(),
});

export type MaterialWithMetadata = z.infer<typeof MaterialWithMetadataSchema>;

// File upload response
export const FileUploadResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  processingStatus: MaterialProcessingStatusSchema,
  message: z.string(),
});

export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;

// Bulk upload response
export const BulkUploadResponseSchema = z.object({
  successful: z.array(FileUploadResponseSchema),
  failed: z.array(z.object({
    fileName: z.string(),
    error: z.string(),
  })),
  totalFiles: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
});

export type BulkUploadResponse = z.infer<typeof BulkUploadResponseSchema>;

// Search materials schema (for semantic search)
export const MaterialSearchSchema = z.object({
  query: z.string().min(1),
  courseId: z.string().uuid().optional(),
  limit: z.number().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.7), // Similarity threshold
});

export type MaterialSearch = z.infer<typeof MaterialSearchSchema>;

// Search result schema
export const MaterialSearchResultSchema = z.object({
  material: MaterialWithMetadataSchema,
  similarity: z.number(),
  matchedText: z.string().optional(),
});

export type MaterialSearchResult = z.infer<typeof MaterialSearchResultSchema>;

// Viewer data schemas for different file types
export const PDFViewerDataSchema = z.object({
  type: z.literal('pdf'),
  url: z.string().url(),
  totalPages: z.number().optional(),
});

export const ImageViewerDataSchema = z.object({
  type: z.literal('image'),
  url: z.string().url(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const VideoViewerDataSchema = z.object({
  type: z.literal('video'),
  url: z.string().url(),
  duration: z.number().optional(),
  thumbnail: z.string().url().optional(),
});

export const PowerPointViewerDataSchema = z.object({
  type: z.literal('powerpoint'),
  url: z.string().url(),
  slideCount: z.number().optional(),
  thumbnails: z.array(z.string().url()).optional(),
});

export const ViewerDataSchema = z.discriminatedUnion('type', [
  PDFViewerDataSchema,
  ImageViewerDataSchema,
  VideoViewerDataSchema,
  PowerPointViewerDataSchema,
]);

export type ViewerData = z.infer<typeof ViewerDataSchema>;

// Error schemas
export const MaterialErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.any()).optional(),
});

export type MaterialError = z.infer<typeof MaterialErrorSchema>;

// Utility functions for file type checking
export const isDocumentType = (mimeType: string): boolean => {
  return [
    SUPPORTED_FILE_TYPES.PDF,
    SUPPORTED_FILE_TYPES.POWERPOINT,
    SUPPORTED_FILE_TYPES.POWERPOINT_LEGACY,
  ].includes(mimeType as any);
};

export const isImageType = (mimeType: string): boolean => {
  return [
    SUPPORTED_FILE_TYPES.JPEG,
    SUPPORTED_FILE_TYPES.PNG,
    SUPPORTED_FILE_TYPES.GIF,
    SUPPORTED_FILE_TYPES.WEBP,
  ].includes(mimeType as any);
};

export const isVideoType = (mimeType: string): boolean => {
  return [
    SUPPORTED_FILE_TYPES.MP4,
    SUPPORTED_FILE_TYPES.WEBM,
    SUPPORTED_FILE_TYPES.AVI,
    SUPPORTED_FILE_TYPES.MOV,
  ].includes(mimeType as any);
};

export const getFileCategory = (mimeType: string): 'document' | 'image' | 'video' | 'unknown' => {
  if (isDocumentType(mimeType)) return 'document';
  if (isImageType(mimeType)) return 'image';
  if (isVideoType(mimeType)) return 'video';
  return 'unknown';
};

export const getMaxFileSize = (mimeType: string): number => {
  const category = getFileCategory(mimeType);
  switch (category) {
    case 'document': return FILE_SIZE_LIMITS.MAX_DOCUMENT_SIZE;
    case 'image': return FILE_SIZE_LIMITS.MAX_IMAGE_SIZE;
    case 'video': return FILE_SIZE_LIMITS.MAX_VIDEO_SIZE;
    default: return FILE_SIZE_LIMITS.MAX_FILE_SIZE;
  }
};
