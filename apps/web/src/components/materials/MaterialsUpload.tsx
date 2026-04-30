"use client";

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Upload, 
  File, 
  Image, 
  Video, 
  FileText, 
  X, 
  CheckCircle, 
  AlertCircle,
  Loader2 
} from 'lucide-react';
import { 
  SUPPORTED_FILE_TYPES, 
  SUPPORTED_FILE_EXTENSIONS, 
  getFileCategory, 
  getMaxFileSize 
} from '@ecoledigitale/contracts';

interface FileUploadItem {
  file: File;
  id: string;
  title: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

interface MaterialsUploadProps {
  courseId: string;
  onUploadComplete?: (materials: any[]) => void;
  onUploadError?: (error: string) => void;
  maxFiles?: number;
}

const getFileIcon = (fileType: string) => {
  const category = getFileCategory(fileType);
  switch (category) {
    case 'document':
      return <FileText className="h-8 w-8 text-red-500" />;
    case 'image':
      return <Image className="h-8 w-8 text-green-500" />;
    case 'video':
      return <Video className="h-8 w-8 text-blue-500" />;
    default:
      return <File className="h-8 w-8 text-gray-500" />;
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export function MaterialsUpload({ 
  courseId, 
  onUploadComplete, 
  onUploadError,
  maxFiles = 10 
}: MaterialsUploadProps) {
  const [uploadItems, setUploadItems] = useState<FileUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const validateFile = (file: File): string | null => {
    // Check file type
    const supportedTypes = Object.values(SUPPORTED_FILE_TYPES);
    if (!supportedTypes.includes(file.type as any)) {
      return `File type ${file.type} is not supported`;
    }

    // Check file size
    const maxSize = getMaxFileSize(file.type);
    if (file.size > maxSize) {
      return `File size exceeds limit of ${formatFileSize(maxSize)}`;
    }

    return null;
  };

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Handle rejected files
    if (rejectedFiles.length > 0) {
      const errors = rejectedFiles.map(({ file, errors }) => 
        `${file.name}: ${errors.map((e: any) => e.message).join(', ')}`
      );
      onUploadError?.(errors.join('\n'));
      return;
    }

    // Validate and add accepted files
    const newItems: FileUploadItem[] = [];
    const errors: string[] = [];

    for (const file of acceptedFiles) {
      if (uploadItems.length + newItems.length >= maxFiles) {
        errors.push(`Maximum ${maxFiles} files allowed`);
        break;
      }

      const validationError = validateFile(file);
      if (validationError) {
        errors.push(`${file.name}: ${validationError}`);
        continue;
      }

      newItems.push({
        file,
        id: Math.random().toString(36).substring(2),
        title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        progress: 0,
        status: 'pending',
      });
    }

    if (errors.length > 0) {
      onUploadError?.(errors.join('\n'));
    }

    if (newItems.length > 0) {
      setUploadItems(prev => [...prev, ...newItems]);
    }
  }, [uploadItems.length, maxFiles, onUploadError]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'video/mp4': ['.mp4'],
      'video/webm': ['.webm'],
      'video/quicktime': ['.mov'],
      'video/x-msvideo': ['.avi'],
    },
    maxFiles,
    disabled: isUploading,
  });

  const updateItemTitle = (id: string, title: string) => {
    setUploadItems(prev => 
      prev.map(item => 
        item.id === id ? { ...item, title } : item
      )
    );
  };

  const removeItem = (id: string) => {
    setUploadItems(prev => prev.filter(item => item.id !== id));
  };

  const uploadFiles = async () => {
    if (uploadItems.length === 0) return;

    setIsUploading(true);
    const completedMaterials: any[] = [];

    for (const item of uploadItems) {
      if (item.status !== 'pending') continue;

      try {
        // Update status to uploading
        // Real upload with progress tracking
        console.log('Uploading file:', item.file.name);

        // Set uploading status
        setUploadItems(prev =>
          prev.map(prevItem =>
            prevItem.id === item.id
              ? { ...prevItem, progress: 0, status: 'uploading' as const }
              : prevItem
          )
        );

        // Create form data
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('title', item.title);
        formData.append('description', item.description || '');

        // Upload to Next.js API route
        const response = await fetch(`/api/courses/${courseId}/materials`, {
          method: 'POST',
          body: formData,
        });

        // Simulate progress for visual feedback
        for (let progress = 20; progress <= 100; progress += 20) {
          setUploadItems(prev =>
            prev.map(prevItem =>
              prevItem.id === item.id
                ? { ...prevItem, progress }
                : prevItem
            )
          );
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        completedMaterials.push(result);

        // Update status to completed
        setUploadItems(prev => 
          prev.map(i => 
            i.id === item.id ? { 
              ...i, 
              status: 'completed' as const, 
              progress: 100 
            } : i
          )
        );

      } catch (error) {
        // Update status to error
        setUploadItems(prev => 
          prev.map(i => 
            i.id === item.id ? { 
              ...i, 
              status: 'error' as const, 
              error: error instanceof Error ? error.message : 'Upload failed'
            } : i
          )
        );
      }
    }

    setIsUploading(false);

    if (completedMaterials.length > 0) {
      onUploadComplete?.(completedMaterials);
    }
  };

  const clearCompleted = () => {
    setUploadItems(prev => prev.filter(item => item.status !== 'completed'));
  };

  const hasCompletedItems = uploadItems.some(item => item.status === 'completed');
  const hasPendingItems = uploadItems.some(item => item.status === 'pending');

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Course Materials
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Drop Zone */}
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${isDragActive 
              ? 'border-blue-500 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
            }
            ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input {...getInputProps()} />
          <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          {isDragActive ? (
            <p className="text-blue-600">Drop the files here...</p>
          ) : (
            <div>
              <p className="text-lg font-medium text-gray-900 mb-2">
                Drag & drop files here, or click to select
              </p>
              <p className="text-sm text-gray-500">
                Supports PDF, PowerPoint, Images, and Videos (max {maxFiles} files)
              </p>
            </div>
          )}
        </div>

        {/* File List */}
        {uploadItems.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Files to Upload</h3>
              <div className="flex gap-2">
                {hasCompletedItems && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearCompleted}
                    disabled={isUploading}
                  >
                    Clear Completed
                  </Button>
                )}
                {hasPendingItems && (
                  <Button
                    onClick={uploadFiles}
                    disabled={isUploading}
                    className="flex items-center gap-2"
                  >
                    {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Téléverser les fichiers
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {uploadItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 p-4 border rounded-lg"
                >
                  {getFileIcon(item.file.type)}
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`title-${item.id}`} className="text-sm font-medium">
                        Title:
                      </Label>
                      <Input
                        id={`title-${item.id}`}
                        value={item.title}
                        onChange={(e) => updateItemTitle(item.id, e.target.value)}
                        disabled={item.status !== 'pending'}
                        className="flex-1"
                      />
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span>{item.file.name}</span>
                      <span>{formatFileSize(item.file.size)}</span>
                    </div>

                    {item.status === 'uploading' && (
                      <Progress value={item.progress} className="w-full" />
                    )}

                    {item.status === 'error' && item.error && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{item.error}</AlertDescription>
                      </Alert>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {item.status === 'completed' && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {item.status === 'error' && (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    )}
                    {item.status === 'uploading' && (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    )}
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      disabled={item.status === 'uploading'}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
