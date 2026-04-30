import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export interface FileStorageConfig {
  baseDirectory: string;
  maxFileSize?: number;
  allowedExtensions?: string[];
}

export interface UploadOptions {
  tenantId: string;
  courseId: string;
  fileName: string;
  contentType: string;
  metadata?: Record<string, any>;
  maxFileSizeBytes?: number;
}

export interface FileInfo {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  metadata?: Record<string, any>;
}

export class FileStorageService {
  private baseDirectory: string;
  private maxFileSize: number;
  private allowedExtensions: string[];

  constructor(config: FileStorageConfig) {
    this.baseDirectory = config.baseDirectory;
    this.maxFileSize = config.maxFileSize || 100 * 1024 * 1024; // 100MB default
    this.allowedExtensions = config.allowedExtensions || [];
  }

  /**
   * Initialize storage directories
   */
  async initialize(): Promise<void> {
    try {
      await fs.access(this.baseDirectory);
    } catch {
      await fs.mkdir(this.baseDirectory, { recursive: true });
    }
  }

  /**
   * Generate a tenant-isolated file path
   */
  private generateFilePath(tenantId: string, courseId: string, fileName: string): string {
    // Sanitize filename to prevent directory traversal
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}_${sanitizedFileName}`;
    
    return path.join(this.baseDirectory, tenantId, courseId, uniqueFileName);
  }

  /**
   * Generate a unique key for the file
   */
  private generateFileKey(tenantId: string, courseId: string, fileName: string): string {
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    return `${tenantId}/${courseId}/${timestamp}_${sanitizedFileName}`;
  }

  /**
   * Upload a file to local storage
   */
  async uploadFile(
    fileBuffer: Buffer,
    options: UploadOptions
  ): Promise<{ key: string; filePath: string }> {
    const maxFileSize = options.maxFileSizeBytes ?? this.maxFileSize;

    // Validate file size
    if (fileBuffer.length > maxFileSize) {
      throw new Error(`File size exceeds maximum allowed size of ${maxFileSize} bytes`);
    }

    const key = this.generateFileKey(options.tenantId, options.courseId, options.fileName);
    const filePath = this.generateFilePath(options.tenantId, options.courseId, options.fileName);
    
    // Ensure directory exists
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });

    // Write file
    await fs.writeFile(filePath, fileBuffer);

    // Write metadata file if provided
    if (options.metadata) {
      const metadataPath = filePath + '.meta.json';
      const metadata = {
        ...options.metadata,
        contentType: options.contentType,
        originalFileName: options.fileName,
        uploadedAt: new Date().toISOString(),
        tenantId: options.tenantId,
        courseId: options.courseId,
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }

    return { key, filePath };
  }

  /**
   * Get file information
   */
  async getFileInfo(key: string): Promise<FileInfo | null> {
    try {
      const filePath = this.keyToFilePath(key);
      const stats = await fs.stat(filePath);
      const metadataPath = filePath + '.meta.json';
      
      let metadata: any = {};
      let contentType = 'application/octet-stream';
      
      try {
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metadataContent);
        contentType = metadata.contentType || contentType;
      } catch {
        // Metadata file doesn't exist, that's okay
      }

      return {
        key,
        size: stats.size,
        contentType,
        lastModified: stats.mtime,
        metadata,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get file stream for reading
   */
  async getFileStream(key: string): Promise<Readable> {
    const filePath = this.keyToFilePath(key);
    
    try {
      await fs.access(filePath);
      return createReadStream(filePath);
    } catch {
      throw new Error('File not found');
    }
  }

  /**
   * Get file buffer
   */
  async getFileBuffer(key: string): Promise<Buffer> {
    const filePath = this.keyToFilePath(key);
    
    try {
      return await fs.readFile(filePath);
    } catch {
      throw new Error('File not found');
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(key: string): Promise<void> {
    const filePath = this.keyToFilePath(key);
    const metadataPath = filePath + '.meta.json';
    
    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist, that's okay
    }
    
    try {
      await fs.unlink(metadataPath);
    } catch {
      // Metadata file might not exist, that's okay
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(key: string): Promise<boolean> {
    const filePath = this.keyToFilePath(key);
    
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get public URL for file (for serving via web server)
   */
  getPublicUrl(key: string, baseUrl: string = ''): string {
    // This would be used if serving files through a web server
    return `${baseUrl}/files/${key}`;
  }

  /**
   * Validate tenant access to a file
   */
  validateTenantAccess(key: string, tenantId: string): boolean {
    return key.startsWith(`${tenantId}/`);
  }

  /**
   * Convert file key to actual file path
   */
  private keyToFilePath(key: string): string {
    // Key format: tenantId/courseId/timestamp_filename
    const parts = key.split('/');
    if (parts.length !== 3) {
      throw new Error('Invalid file key format');
    }
    
    return path.join(this.baseDirectory, ...parts);
  }

  /**
   * List files for a course
   */
  async listCourseFiles(tenantId: string, courseId: string): Promise<string[]> {
    const courseDirectory = path.join(this.baseDirectory, tenantId, courseId);
    
    try {
      const files = await fs.readdir(courseDirectory);
      // Filter out metadata files and return only actual files
      return files
        .filter(file => !file.endsWith('.meta.json'))
        .map(file => `${tenantId}/${courseId}/${file}`);
    } catch {
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    tenantStats: Record<string, { files: number; size: number }>;
  }> {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      tenantStats: {} as Record<string, { files: number; size: number }>,
    };

    try {
      const tenants = await fs.readdir(this.baseDirectory);
      
      for (const tenant of tenants) {
        const tenantPath = path.join(this.baseDirectory, tenant);
        const tenantStat = await fs.stat(tenantPath);
        
        if (tenantStat.isDirectory()) {
          stats.tenantStats[tenant] = { files: 0, size: 0 };
          
          const courses = await fs.readdir(tenantPath);
          for (const course of courses) {
            const coursePath = path.join(tenantPath, course);
            const courseStat = await fs.stat(coursePath);
            
            if (courseStat.isDirectory()) {
              const files = await fs.readdir(coursePath);
              for (const file of files) {
                if (!file.endsWith('.meta.json')) {
                  const filePath = path.join(coursePath, file);
                  const fileStat = await fs.stat(filePath);
                  
                  stats.totalFiles++;
                  stats.totalSize += fileStat.size;
                  stats.tenantStats[tenant].files++;
                  stats.tenantStats[tenant].size += fileStat.size;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error getting storage stats:', error);
    }

    return stats;
  }

  /**
   * Clean up old files (optional maintenance function)
   */
  async cleanupOldFiles(maxAgeMs: number): Promise<number> {
    let deletedCount = 0;
    const cutoffTime = Date.now() - maxAgeMs;

    try {
      const tenants = await fs.readdir(this.baseDirectory);
      
      for (const tenant of tenants) {
        const tenantPath = path.join(this.baseDirectory, tenant);
        const tenantStat = await fs.stat(tenantPath);
        
        if (tenantStat.isDirectory()) {
          const courses = await fs.readdir(tenantPath);
          for (const course of courses) {
            const coursePath = path.join(tenantPath, course);
            const courseStat = await fs.stat(coursePath);
            
            if (courseStat.isDirectory()) {
              const files = await fs.readdir(coursePath);
              for (const file of files) {
                if (!file.endsWith('.meta.json')) {
                  const filePath = path.join(coursePath, file);
                  const fileStat = await fs.stat(filePath);
                  
                  if (fileStat.mtime.getTime() < cutoffTime) {
                    await this.deleteFile(`${tenant}/${course}/${file}`);
                    deletedCount++;
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }

    return deletedCount;
  }
}

// Create singleton instance
let fileStorageService: FileStorageService | null = null;

export function getFileStorageService(): FileStorageService {
  if (!fileStorageService) {
    const config: FileStorageConfig = {
      baseDirectory: process.env.FILE_STORAGE_PATH || path.join(process.cwd(), 'uploads'),
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB
    };

    fileStorageService = new FileStorageService(config);
  }

  return fileStorageService;
}

// Initialize storage on module load
getFileStorageService().initialize().catch(console.error);
