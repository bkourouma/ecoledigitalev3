"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, ExternalLink, FileText, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface AssignmentDownloadUnifiedProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  showFileName?: boolean;
}

export default function AssignmentDownloadUnified({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = "",
  variant = "outline",
  size = "sm",
  showFileName = true
}: AssignmentDownloadUnifiedProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      setError('Aucun fichier disponible');
      return;
    }

    setIsDownloading(true);
    setError(null);
    
    try {
      console.log('=== UNIFIED DOWNLOAD ===');
      console.log('File URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      console.log('File Name:', fileName);

      // Try to extract tenant/course/filename from the fileUrl.
      // Supported formats:
      // - /api/v1/files/{tenantId}/{courseId}/{filename}
      // - /api/v1/files/{tenantId}/{courseId}/submissions/{filename}
      const urlParts = fileUrl.split('/');
      const tenantId = (session as any)?.tenantId || 'imhotepacademy';
      const userId = (session?.user as any)?.id || '';
      
      if (urlParts.length >= 7 && urlParts[1] === 'api' && urlParts[2] === 'v1' && urlParts[3] === 'files') {
        const apiUrl = process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '';
        const urlTenantId = urlParts[4];
        const courseId = urlParts[5];
        const isNestedSubmissionFile = urlParts[6] === 'submissions' && Boolean(urlParts[7]);
        const filename = isNestedSubmissionFile ? urlParts.slice(7).join('/') : urlParts.slice(6).join('/');
        const downloadUrl = isNestedSubmissionFile
          ? `${apiUrl}${fileUrl}`
          : `${apiUrl}/api/v1/files/serve-file?${new URLSearchParams({
              tenantId: urlTenantId,
              courseId,
              filename,
            }).toString()}`;
        
        console.log(isNestedSubmissionFile ? 'Using direct submission file endpoint:' : 'Using serve-file endpoint:', downloadUrl);
        
        const response = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            'X-Tenant': tenantId,
          },
          credentials: 'include',
        });

        if (response.ok) {
          // Success - download the file
          const blob = await response.blob();
          
          // Verify it's a valid file
          if (blob.size === 0) {
            throw new Error('Le fichier est vide');
          }
          
          // Create download link
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName || 'devoir.pdf';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          // Clean up
          window.URL.revokeObjectURL(url);
          
          toast.success(`📄 ${fileName || 'Fichier'} téléchargé avec succès !`);
          console.log('✅ Download successful:', {
            fileName,
            size: blob.size,
            type: blob.type
          });
        } else {
          console.log('❌ Serve-file download failed:', response.status, response.statusText);
          
          // Try to get error details
          let errorMessage = 'Erreur lors du téléchargement';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
            console.log('Serve-file error details:', errorData);
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }

          // Show specific error message to user
          if (response.status === 401) {
            toast.error('Session expirée. Veuillez vous reconnecter.');
          } else if (response.status === 404) {
            toast.error('Fichier non trouvé. Contactez votre enseignant.');
          } else {
            toast.error(errorMessage);
          }

          setError(errorMessage);

          // Fallback: Try to open in new tab
          console.log('🔄 Fallback: opening in new tab');
          try {
            const fallbackUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
            window.open(fallbackUrl, '_blank');
            toast.success('Ouverture du fichier dans un nouvel onglet');
          } catch (fallbackError) {
            console.error('Final fallback also failed:', fallbackError);
            toast.error('Impossible d\'ouvrir le fichier. Contactez le support technique.');
          }
        }
      } else {
        // Fallback to direct-download method for other URL formats
        console.log('Using direct download API (fallback method)');

        const response = await fetch('/api/v1/files/direct-download', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            fileUrl,
            assignmentId,
            fileName
          })
        });

        if (response.ok) {
          // Success - download the file
          const blob = await response.blob();
          
          // Verify it's a valid file
          if (blob.size === 0) {
            throw new Error('Le fichier est vide');
          }
          
          // Create download link
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName || 'devoir.pdf';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          // Clean up
          window.URL.revokeObjectURL(url);
          
          toast.success(`📄 ${fileName || 'Fichier'} téléchargé avec succès !`);
          console.log('✅ Download successful:', {
            fileName,
            size: blob.size,
            type: blob.type
          });
        } else {
          console.log('❌ Direct download failed:', response.status, response.statusText);

          // Try to get error details
          let errorMessage = 'Erreur lors du téléchargement';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
            console.log('Direct download error details:', errorData);
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }

          // Show specific error message to user
          if (response.status === 401) {
            toast.error('Session expirée. Veuillez vous reconnecter.');
          } else if (response.status === 404) {
            toast.error('Fichier non trouvé. Contactez votre enseignant.');
          } else {
            toast.error(errorMessage);
          }

          setError(errorMessage);

          // Fallback: Try to open in new tab
          console.log('🔄 Fallback: opening in new tab');
          try {
            const fallbackUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
            window.open(fallbackUrl, '_blank');
            toast.success('Ouverture du fichier dans un nouvel onglet');
          } catch (fallbackError) {
            console.error('Final fallback also failed:', fallbackError);
            toast.error('Impossible d\'ouvrir le fichier. Contactez le support technique.');
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Download error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur lors du téléchargement';
      setError(errorMessage);
      toast.error(errorMessage);
      
      // Final fallback: try to open in new tab
      try {
        const fallbackUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        window.open(fallbackUrl, '_blank');
        toast.success('Ouverture du fichier dans un nouvel onglet (mode de secours)');
      } catch (fallbackError) {
        console.error('❌ Fallback also failed:', fallbackError);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  if (!fileUrl) {
    return (
      <Alert className="max-w-md">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Aucun document disponible pour ce devoir
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        size={size}
        onClick={handleDownload}
        disabled={disabled || isDownloading}
        className={className}
      >
        {isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <Download className="w-4 h-4 mr-2" />
        )}
        {isDownloading ? 'Téléchargement...' : 'Télécharger PDF'}
      </Button>
      
      {showFileName && fileName && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <FileText className="w-3 h-3" />
          <span className="truncate">{fileName}</span>
        </div>
      )}
      
      {error && (
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
    </div>
  );
}
