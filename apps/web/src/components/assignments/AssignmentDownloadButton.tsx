"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadButtonProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadButton({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      // Construct the full URL if it's relative
      const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
      
      console.log('Downloading from URL:', fullUrl);
      
      // Use the file URL directly with proper headers
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'X-Tenant': 'imhotepacademy',
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Erreur inconnue');
        console.error('Download failed:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          url: fullUrl
        });
        throw new Error(`Erreur ${response.status}: ${response.statusText} - ${errorText}`);
      }

      // Get the file content
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'devoir.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      window.URL.revokeObjectURL(url);
      
      toast.success('Téléchargement réussi !');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Erreur lors du téléchargement du fichier');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={disabled || isDownloading || !fileUrl}
      className={className}
    >
      {isDownloading ? (
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
      ) : (
        <Download className="w-4 h-4 mr-2" />
      )}
      {isDownloading ? 'Téléchargement...' : 'Télécharger'}
    </Button>
  );
}
