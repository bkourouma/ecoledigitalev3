"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadButtonV2Props {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadButtonV2({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadButtonV2Props) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      // Method 1: Try direct download with proper URL construction
      let downloadUrl = fileUrl;
      
      // If the URL is relative, make it absolute
      if (!fileUrl.startsWith('http')) {
        downloadUrl = `http://localhost:4000${fileUrl}`;
      }
      
      console.log('Attempting download from:', downloadUrl);
      
      // Try to download directly
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'X-Tenant': 'imhotepacademy',
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
        },
      });

      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`);
      }

      // Get the file content
      const blob = await response.blob();
      
      // Verify it's a PDF
      if (blob.type !== 'application/pdf' && !blob.type.includes('pdf')) {
        console.warn('File type might not be PDF:', blob.type);
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
      
      toast.success('Téléchargement réussi !');
    } catch (error) {
      console.error('Download error:', error);
      
      // Fallback: Try opening in new tab
      try {
        const fallbackUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        window.open(fallbackUrl, '_blank');
        toast.success('Ouverture du fichier dans un nouvel onglet');
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        toast.error('Impossible de télécharger le fichier. Vérifiez votre connexion.');
      }
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
