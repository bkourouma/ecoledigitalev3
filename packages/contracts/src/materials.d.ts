import { z } from "zod";
export declare const SUPPORTED_FILE_TYPES: {
    readonly PDF: "application/pdf";
    readonly POWERPOINT: "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    readonly POWERPOINT_LEGACY: "application/vnd.ms-powerpoint";
    readonly JPEG: "image/jpeg";
    readonly PNG: "image/png";
    readonly GIF: "image/gif";
    readonly WEBP: "image/webp";
    readonly MP4: "video/mp4";
    readonly WEBM: "video/webm";
    readonly AVI: "video/avi";
    readonly MOV: "video/quicktime";
};
export declare const SUPPORTED_FILE_EXTENSIONS: readonly [".pdf", ".pptx", ".ppt", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".avi", ".mov"];
export declare const FILE_SIZE_LIMITS: {
    readonly MAX_FILE_SIZE: number;
    readonly MAX_IMAGE_SIZE: number;
    readonly MAX_VIDEO_SIZE: number;
    readonly MAX_DOCUMENT_SIZE: number;
};
export declare const MaterialProcessingStatusSchema: z.ZodEnum<["pending", "processing", "completed", "failed"]>;
export type MaterialProcessingStatus = z.infer<typeof MaterialProcessingStatusSchema>;
export declare const CourseMaterialSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    courseId: z.ZodString;
    title: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodString;
    fileSize: z.ZodNumber;
    minioKey: z.ZodString;
    contentText: z.ZodNullable<z.ZodString>;
    embedding: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
    uploadedBy: z.ZodString;
    processingStatus: z.ZodEnum<["pending", "processing", "completed", "failed"]>;
    processingError: z.ZodNullable<z.ZodString>;
    processedAt: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    courseId: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    minioKey: string;
    contentText: string | null;
    embedding: number[] | null;
    uploadedBy: string;
    processingStatus: "completed" | "pending" | "processing" | "failed";
    processingError: string | null;
    processedAt: string | null;
}, {
    id: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    courseId: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    minioKey: string;
    contentText: string | null;
    embedding: number[] | null;
    uploadedBy: string;
    processingStatus: "completed" | "pending" | "processing" | "failed";
    processingError: string | null;
    processedAt: string | null;
}>;
export type CourseMaterial = z.infer<typeof CourseMaterialSchema>;
export declare const CreateCourseMaterialSchema: z.ZodObject<{
    courseId: z.ZodString;
    title: z.ZodString;
}, "strip", z.ZodTypeAny, {
    courseId: string;
    title: string;
}, {
    courseId: string;
    title: string;
}>;
export type CreateCourseMaterial = z.infer<typeof CreateCourseMaterialSchema>;
export declare const UpdateCourseMaterialSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title?: string | undefined;
}, {
    title?: string | undefined;
}>;
export type UpdateCourseMaterial = z.infer<typeof UpdateCourseMaterialSchema>;
export declare const MaterialQuerySchema: z.ZodObject<{
    courseId: z.ZodOptional<z.ZodString>;
    fileType: z.ZodOptional<z.ZodString>;
    processingStatus: z.ZodOptional<z.ZodEnum<["pending", "processing", "completed", "failed"]>>;
    search: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    sortBy: z.ZodDefault<z.ZodEnum<["createdAt", "title", "fileSize"]>>;
    sortOrder: z.ZodDefault<z.ZodEnum<["asc", "desc"]>>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    sortBy: "createdAt" | "title" | "fileSize";
    sortOrder: "asc" | "desc";
    search?: string | undefined;
    courseId?: string | undefined;
    fileType?: string | undefined;
    processingStatus?: "completed" | "pending" | "processing" | "failed" | undefined;
}, {
    search?: string | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    courseId?: string | undefined;
    fileType?: string | undefined;
    processingStatus?: "completed" | "pending" | "processing" | "failed" | undefined;
    sortBy?: "createdAt" | "title" | "fileSize" | undefined;
    sortOrder?: "asc" | "desc" | undefined;
}>;
export type MaterialQuery = z.infer<typeof MaterialQuerySchema>;
export declare const MaterialWithMetadataSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    courseId: z.ZodString;
    title: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodString;
    fileSize: z.ZodNumber;
    minioKey: z.ZodString;
    contentText: z.ZodNullable<z.ZodString>;
    embedding: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
    uploadedBy: z.ZodString;
    processingStatus: z.ZodEnum<["pending", "processing", "completed", "failed"]>;
    processingError: z.ZodNullable<z.ZodString>;
    processedAt: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
} & {
    uploadedByName: z.ZodString;
    courseName: z.ZodString;
    canEdit: z.ZodBoolean;
    canDelete: z.ZodBoolean;
    viewerUrl: z.ZodOptional<z.ZodString>;
    downloadUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    courseId: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    minioKey: string;
    contentText: string | null;
    embedding: number[] | null;
    uploadedBy: string;
    processingStatus: "completed" | "pending" | "processing" | "failed";
    processingError: string | null;
    processedAt: string | null;
    uploadedByName: string;
    courseName: string;
    canEdit: boolean;
    canDelete: boolean;
    viewerUrl?: string | undefined;
    downloadUrl?: string | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    courseId: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    minioKey: string;
    contentText: string | null;
    embedding: number[] | null;
    uploadedBy: string;
    processingStatus: "completed" | "pending" | "processing" | "failed";
    processingError: string | null;
    processedAt: string | null;
    uploadedByName: string;
    courseName: string;
    canEdit: boolean;
    canDelete: boolean;
    viewerUrl?: string | undefined;
    downloadUrl?: string | undefined;
}>;
export type MaterialWithMetadata = z.infer<typeof MaterialWithMetadataSchema>;
export declare const FileUploadResponseSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    fileName: z.ZodString;
    fileType: z.ZodString;
    fileSize: z.ZodNumber;
    processingStatus: z.ZodEnum<["pending", "processing", "completed", "failed"]>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    id: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    processingStatus: "completed" | "pending" | "processing" | "failed";
}, {
    message: string;
    id: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    processingStatus: "completed" | "pending" | "processing" | "failed";
}>;
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;
export declare const BulkUploadResponseSchema: z.ZodObject<{
    successful: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        processingStatus: z.ZodEnum<["pending", "processing", "completed", "failed"]>;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        message: string;
        id: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        processingStatus: "completed" | "pending" | "processing" | "failed";
    }, {
        message: string;
        id: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        processingStatus: "completed" | "pending" | "processing" | "failed";
    }>, "many">;
    failed: z.ZodArray<z.ZodObject<{
        fileName: z.ZodString;
        error: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        error: string;
        fileName: string;
    }, {
        error: string;
        fileName: string;
    }>, "many">;
    totalFiles: z.ZodNumber;
    successCount: z.ZodNumber;
    failureCount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    failed: {
        error: string;
        fileName: string;
    }[];
    successful: {
        message: string;
        id: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        processingStatus: "completed" | "pending" | "processing" | "failed";
    }[];
    totalFiles: number;
    successCount: number;
    failureCount: number;
}, {
    failed: {
        error: string;
        fileName: string;
    }[];
    successful: {
        message: string;
        id: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        processingStatus: "completed" | "pending" | "processing" | "failed";
    }[];
    totalFiles: number;
    successCount: number;
    failureCount: number;
}>;
export type BulkUploadResponse = z.infer<typeof BulkUploadResponseSchema>;
export declare const MaterialSearchSchema: z.ZodObject<{
    query: z.ZodString;
    courseId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query: string;
    limit: number;
    threshold: number;
    courseId?: string | undefined;
}, {
    query: string;
    limit?: number | undefined;
    courseId?: string | undefined;
    threshold?: number | undefined;
}>;
export type MaterialSearch = z.infer<typeof MaterialSearchSchema>;
export declare const MaterialSearchResultSchema: z.ZodObject<{
    material: z.ZodObject<{
        id: z.ZodString;
        tenantId: z.ZodString;
        courseId: z.ZodString;
        title: z.ZodString;
        fileName: z.ZodString;
        fileType: z.ZodString;
        fileSize: z.ZodNumber;
        minioKey: z.ZodString;
        contentText: z.ZodNullable<z.ZodString>;
        embedding: z.ZodNullable<z.ZodArray<z.ZodNumber, "many">>;
        uploadedBy: z.ZodString;
        processingStatus: z.ZodEnum<["pending", "processing", "completed", "failed"]>;
        processingError: z.ZodNullable<z.ZodString>;
        processedAt: z.ZodNullable<z.ZodString>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    } & {
        uploadedByName: z.ZodString;
        courseName: z.ZodString;
        canEdit: z.ZodBoolean;
        canDelete: z.ZodBoolean;
        viewerUrl: z.ZodOptional<z.ZodString>;
        downloadUrl: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        tenantId: string;
        createdAt: string;
        updatedAt: string;
        courseId: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        minioKey: string;
        contentText: string | null;
        embedding: number[] | null;
        uploadedBy: string;
        processingStatus: "completed" | "pending" | "processing" | "failed";
        processingError: string | null;
        processedAt: string | null;
        uploadedByName: string;
        courseName: string;
        canEdit: boolean;
        canDelete: boolean;
        viewerUrl?: string | undefined;
        downloadUrl?: string | undefined;
    }, {
        id: string;
        tenantId: string;
        createdAt: string;
        updatedAt: string;
        courseId: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        minioKey: string;
        contentText: string | null;
        embedding: number[] | null;
        uploadedBy: string;
        processingStatus: "completed" | "pending" | "processing" | "failed";
        processingError: string | null;
        processedAt: string | null;
        uploadedByName: string;
        courseName: string;
        canEdit: boolean;
        canDelete: boolean;
        viewerUrl?: string | undefined;
        downloadUrl?: string | undefined;
    }>;
    similarity: z.ZodNumber;
    matchedText: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    material: {
        id: string;
        tenantId: string;
        createdAt: string;
        updatedAt: string;
        courseId: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        minioKey: string;
        contentText: string | null;
        embedding: number[] | null;
        uploadedBy: string;
        processingStatus: "completed" | "pending" | "processing" | "failed";
        processingError: string | null;
        processedAt: string | null;
        uploadedByName: string;
        courseName: string;
        canEdit: boolean;
        canDelete: boolean;
        viewerUrl?: string | undefined;
        downloadUrl?: string | undefined;
    };
    similarity: number;
    matchedText?: string | undefined;
}, {
    material: {
        id: string;
        tenantId: string;
        createdAt: string;
        updatedAt: string;
        courseId: string;
        title: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        minioKey: string;
        contentText: string | null;
        embedding: number[] | null;
        uploadedBy: string;
        processingStatus: "completed" | "pending" | "processing" | "failed";
        processingError: string | null;
        processedAt: string | null;
        uploadedByName: string;
        courseName: string;
        canEdit: boolean;
        canDelete: boolean;
        viewerUrl?: string | undefined;
        downloadUrl?: string | undefined;
    };
    similarity: number;
    matchedText?: string | undefined;
}>;
export type MaterialSearchResult = z.infer<typeof MaterialSearchResultSchema>;
export declare const PDFViewerDataSchema: z.ZodObject<{
    type: z.ZodLiteral<"pdf">;
    url: z.ZodString;
    totalPages: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "pdf";
    totalPages?: number | undefined;
}, {
    url: string;
    type: "pdf";
    totalPages?: number | undefined;
}>;
export declare const ImageViewerDataSchema: z.ZodObject<{
    type: z.ZodLiteral<"image">;
    url: z.ZodString;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "image";
    width?: number | undefined;
    height?: number | undefined;
}, {
    url: string;
    type: "image";
    width?: number | undefined;
    height?: number | undefined;
}>;
export declare const VideoViewerDataSchema: z.ZodObject<{
    type: z.ZodLiteral<"video">;
    url: z.ZodString;
    duration: z.ZodOptional<z.ZodNumber>;
    thumbnail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "video";
    duration?: number | undefined;
    thumbnail?: string | undefined;
}, {
    url: string;
    type: "video";
    duration?: number | undefined;
    thumbnail?: string | undefined;
}>;
export declare const PowerPointViewerDataSchema: z.ZodObject<{
    type: z.ZodLiteral<"powerpoint">;
    url: z.ZodString;
    slideCount: z.ZodOptional<z.ZodNumber>;
    thumbnails: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "powerpoint";
    slideCount?: number | undefined;
    thumbnails?: string[] | undefined;
}, {
    url: string;
    type: "powerpoint";
    slideCount?: number | undefined;
    thumbnails?: string[] | undefined;
}>;
export declare const ViewerDataSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"pdf">;
    url: z.ZodString;
    totalPages: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "pdf";
    totalPages?: number | undefined;
}, {
    url: string;
    type: "pdf";
    totalPages?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    url: z.ZodString;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "image";
    width?: number | undefined;
    height?: number | undefined;
}, {
    url: string;
    type: "image";
    width?: number | undefined;
    height?: number | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"video">;
    url: z.ZodString;
    duration: z.ZodOptional<z.ZodNumber>;
    thumbnail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "video";
    duration?: number | undefined;
    thumbnail?: string | undefined;
}, {
    url: string;
    type: "video";
    duration?: number | undefined;
    thumbnail?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"powerpoint">;
    url: z.ZodString;
    slideCount: z.ZodOptional<z.ZodNumber>;
    thumbnails: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    url: string;
    type: "powerpoint";
    slideCount?: number | undefined;
    thumbnails?: string[] | undefined;
}, {
    url: string;
    type: "powerpoint";
    slideCount?: number | undefined;
    thumbnails?: string[] | undefined;
}>]>;
export type ViewerData = z.infer<typeof ViewerDataSchema>;
export declare const MaterialErrorSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    details?: Record<string, any> | undefined;
}, {
    code: string;
    message: string;
    details?: Record<string, any> | undefined;
}>;
export type MaterialError = z.infer<typeof MaterialErrorSchema>;
export declare const isDocumentType: (mimeType: string) => boolean;
export declare const isImageType: (mimeType: string) => boolean;
export declare const isVideoType: (mimeType: string) => boolean;
export declare const getFileCategory: (mimeType: string) => "document" | "image" | "video" | "unknown";
export declare const getMaxFileSize: (mimeType: string) => number;
//# sourceMappingURL=materials.d.ts.map