import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

export interface MinIOConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  forcePathStyle?: boolean;
}

export interface UploadOptions {
  tenantId: string;
  courseId: string;
  fileName: string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface FileInfo {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

export class MinIOService {
  private s3Client: S3Client;
  private bucket: string;

  constructor(config: MinIOConfig) {
    this.bucket = config.bucket;
    
    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: config.forcePathStyle ?? true, // Required for MinIO
    });
  }

  /**
   * Generate a tenant-isolated object key
   */
  private generateObjectKey(tenantId: string, courseId: string, fileName: string): string {
    // Create a safe filename
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    
    return `tenants/${tenantId}/courses/${courseId}/materials/${timestamp}_${randomSuffix}_${safeFileName}`;
  }

  /**
   * Upload a file to MinIO
   */
  async uploadFile(
    fileBuffer: Buffer,
    options: UploadOptions
  ): Promise<{ key: string; url: string }> {
    const key = this.generateObjectKey(options.tenantId, options.courseId, options.fileName);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: options.contentType,
      Metadata: {
        tenantId: options.tenantId,
        courseId: options.courseId,
        originalFileName: options.fileName,
        uploadedAt: new Date().toISOString(),
        ...options.metadata,
      },
    });

    await this.s3Client.send(command);

    // Generate a presigned URL for immediate access
    const url = await this.getPresignedUrl(key, 3600); // 1 hour expiry

    return { key, url };
  }

  /**
   * Get file information
   */
  async getFileInfo(key: string): Promise<FileInfo | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      return {
        key,
        size: response.ContentLength || 0,
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        metadata: response.Metadata,
      };
    } catch (error: any) {
      if (error.name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get a presigned URL for file access
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Get file stream for direct serving
   */
  async getFileStream(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('File not found or empty');
    }

    return response.Body as Readable;
  }

  /**
   * Delete a file
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  /**
   * Validate tenant access to a file
   */
  validateTenantAccess(key: string, tenantId: string): boolean {
    return key.startsWith(`tenants/${tenantId}/`);
  }

  /**
   * Extract metadata from object key
   */
  parseObjectKey(key: string): {
    tenantId: string;
    courseId: string;
    fileName: string;
  } | null {
    const match = key.match(/^tenants\/([^\/]+)\/courses\/([^\/]+)\/materials\/\d+_[^_]+_(.+)$/);
    
    if (!match) {
      return null;
    }

    return {
      tenantId: match[1],
      courseId: match[2],
      fileName: match[3],
    };
  }

  /**
   * Generate a secure download URL with tenant validation
   */
  async getSecureDownloadUrl(
    key: string, 
    tenantId: string, 
    expiresIn: number = 3600
  ): Promise<string> {
    // Validate tenant access
    if (!this.validateTenantAccess(key, tenantId)) {
      throw new Error('Access denied: Invalid tenant access to file');
    }

    // Check if file exists
    const fileInfo = await this.getFileInfo(key);
    if (!fileInfo) {
      throw new Error('File not found');
    }

    return await this.getPresignedUrl(key, expiresIn);
  }

  /**
   * Get file buffer for processing
   */
  async getFileBuffer(key: string): Promise<Buffer> {
    const stream = await this.getFileStream(key);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}

// Create singleton instance
let minioService: MinIOService | null = null;

export function getMinIOService(): MinIOService {
  if (!minioService) {
    const config: MinIOConfig = {
      endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      bucket: process.env.MINIO_BUCKET || 'course-materials',
      region: process.env.MINIO_REGION || 'us-east-1',
      forcePathStyle: true,
    };

    minioService = new MinIOService(config);
  }

  return minioService;
}

// Export for testing - removed duplicate export
